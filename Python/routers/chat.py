# chat.py — LEARNING SCAFFOLD (intentionally incomplete!)
#
# This router is the student's project: a messenger-style chat with a global
# room, one room per district, and private DMs. Every endpoint below returns
# a {"status": "todo"} placeholder until you implement it.
#
# Start here:
#   * The full mission list lives in docs/STUDENT_CHAT_BACKEND_GUIDE.md.
#   * The tables you need (chat_rooms, chat_messages, dm_conversations,
#     dm_messages) already exist — see
#     Python/migrations/003_chat_learning_schema.sql.
#   * Copy working patterns from the finished routers, e.g. routers/auth.py:
#       - run SQL with:            with db() as conn: cur = conn.cursor()
#       - read the logged-in user: user_id = request.session.get("user_id")
#       - reject anonymous calls:  raise HTTPException(status_code=401, ...)
#
# The frontend chat popup (artifacts/peerbridge/src/components/ChatWidget.tsx)
# already calls these endpoints. While they return {"status": "todo"} it shows
# a practice-task notice; as soon as you return real data, the tabs come alive.

from fastapi import APIRouter, Request, WebSocket, HTTPException
from pydantic import BaseModel

from db import db  # imported for you — every mission's queries will use it

# REST endpoints; main.py mounts this under /api (so: GET /api/chat/rooms).
router = APIRouter()

# WebSocket endpoints; mounted WITHOUT the /api prefix (so: /ws/chat/rooms/1).
ws_router = APIRouter()


class SendMessageBody(BaseModel):
    body: str


class StartDmBody(BaseModel):
    toUserId: int


def _todo(mission: int, message: str) -> dict:
    """Placeholder response every unimplemented endpoint returns."""
    return {
        "status": "todo",
        "mission": mission,
        "message": f"Student TODO: {message}",
        "guide": "docs/STUDENT_CHAT_BACKEND_GUIDE.md",
    }


# ===========================================================================
# SHARED HELPERS — your toolbox for every mission.
#
# These are handed to you on purpose. Read each one's Definition / Usage /
# Used-by note, then COMPOSE them inside your endpoints — Mission 1 below is a
# finished worked example of exactly that. Most helpers stay unused until you
# reach the mission that needs them; that is expected, not dead code.
#
# The two big ideas they encode, so you don't rewrite them eight times:
#   * every REST endpoint runs its SQL inside `with db() as conn:` and shapes
#     rows into camelCase JSON with a `_format_*` helper;
#   * "load + access check" (rooms, DM membership) and "re-select one row after
#     an INSERT" are each a single helper you call, not logic you re-type.
# ===========================================================================

# A single, generous ceiling for any message body (rooms and DMs alike).
MAX_MESSAGE_LEN = 2000


def _require_user(request: Request) -> int:
    """Return the logged-in user's id, or raise HTTP 401.

    Definition: reads ``user_id`` out of the session cookie (SessionMiddleware
        stores it there at login — see routers/auth.py).
    Usage: make it the FIRST line of every REST endpoint that needs a user::

            user_id = _require_user(request)

        It raises ``HTTPException(401)`` itself, so you never repeat the check.
    Used by: Missions 1, 2, 3, 5, 6, 7.
    """
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user_id


def _clean_body(raw: str) -> str:
    """Validate + normalise message text, or raise HTTP 400.

    Definition: strips surrounding whitespace, rejects empty / whitespace-only
        text, and enforces ``MAX_MESSAGE_LEN``.
    Usage: run every incoming message body through it before you INSERT::

            text = _clean_body(body.body)

    Used by: Missions 3 and 7b (and inside the WebSocket loops, 4 and 8).
    """
    body = (raw or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Message body cannot be empty")
    if len(body) > MAX_MESSAGE_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Message too long (max {MAX_MESSAGE_LEN} characters)",
        )
    return body


def _format_room(row) -> dict:
    """Shape a ``chat_rooms`` row into the camelCase JSON the frontend expects.

    Definition: maps DB columns -> ``{id, type, districtId, name}``.
    Usage: ``return [_format_room(r) for r in rows]`` at the end of Mission 1.
    Used by: Mission 1.
    """
    return {
        "id": row["id"],
        "type": row["type"],
        "districtId": row["district_id"],
        "name": row["name"],
    }


def _format_chat_message(row) -> dict:
    """Shape a ``chat_messages`` row (JOINed with the sender's name) into JSON.

    Definition: maps -> ``{id, roomId, senderId, senderName, body, createdAt}``;
        ``createdAt`` uses ``.isoformat()``. The row must carry a ``sender_name``
        column, which you get by JOINing ``users`` (see ``_fetch_chat_message``).
    Usage: ``return [_format_chat_message(m) for m in rows]`` (Mission 2), or on
        a single freshly-inserted row (Missions 3, 4).
    Used by: Missions 2, 3, 4
    """
    return {
        "id": row["id"],
        "roomId": row["room_id"],
        "senderId": row["sender_id"],
        "senderName": row["sender_name"],
        "body": row["body"],
        "createdAt": row["created_at"].isoformat(),
    }


def _format_conversation(row) -> dict:
    """Shape a ``dm_conversations`` row (from one user's POV) into JSON.

    Definition: maps -> ``{id, otherUserId, otherUserName, createdAt}``. The row
        must already resolve "the other participant" (see ``_fetch_conversation``).
    Usage: ``return [_format_conversation(c) for c in rows]`` (Mission 5) or on a
        single row (Mission 6).
    Used by: Missions 5, 6.
    """
    return {
        "id": row["id"],
        "otherUserId": row["other_user_id"],
        "otherUserName": row["other_user_name"],
        "createdAt": row["created_at"].isoformat(),
    }


def _format_dm_message(row) -> dict:
    """Shape a ``dm_messages`` row into JSON. ``readAt`` is null until seen.

    Definition: maps -> ``{id, conversationId, senderId, body, createdAt, readAt}``.
    Usage: ``return [_format_dm_message(m) for m in rows]`` (Mission 7a) or on a
        single freshly-inserted row (Missions 7b, 8).
    Used by: Missions 7, 8.
    """
    return {
        "id": row["id"],
        "conversationId": row["conversation_id"],
        "senderId": row["sender_id"],
        "body": row["body"],
        "createdAt": row["created_at"].isoformat(),
        "readAt": row["read_at"].isoformat() if row["read_at"] else None,
    }


def _load_room_for_user(cur, room_id: int, user_id: int) -> dict:
    """Fetch a room and enforce access, or raise 404 / 403. Returns the room row.

    Definition: 404 if the room doesn't exist; for a ``'district'`` room, 403
        unless it is the caller's own district. A ``'global'`` room is open to all.
    Usage: call it right after opening a cursor, before you read or write a room::

            with db() as conn:
                cur = conn.cursor()
                _load_room_for_user(cur, room_id, user_id)   # guard first
                ...                                           # then your query

    Used by: Missions 2, 3, 4.
    """
    cur.execute(
        "SELECT id, type, district_id, name FROM chat_rooms WHERE id = %s",
        (room_id,),
    )
    room = cur.fetchone()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room["type"] == "district":
        cur.execute("SELECT district_id FROM users WHERE id = %s", (user_id,))
        me = cur.fetchone()
        if not me or me["district_id"] != room["district_id"]:
            raise HTTPException(
                status_code=403,
                detail="You can only access your own district's room",
            )
    return room


def _fetch_chat_message(cur, message_id: int) -> dict:
    """Re-select one room message JOINed with its sender's name, as JSON.

    Definition: runs the same SELECT + JOIN as the history query but for a single
        id, then formats it — so an INSERT can return the exact same shape as the
        list endpoint.
    Usage: after ``INSERT ... RETURNING id``::

            new_id = cur.fetchone()["id"]
            return _fetch_chat_message(cur, new_id)

    Used by: Missions 3, 4.
    """
    cur.execute(
        """SELECT m.id, m.room_id, m.sender_id, u.name AS sender_name,
                  m.body, m.created_at
           FROM chat_messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.id = %s""",
        (message_id,),
    )
    return _format_chat_message(cur.fetchone())


def _load_conversation_membership(cur, conversation_id: int, user_id: int) -> dict:
    """Fetch a DM conversation and enforce privacy, or raise 404 / 403.

    Definition: 404 if it doesn't exist; 403 unless the caller is one of the two
        participants. This is the single most important guard in the project —
        DMs are private.
    Usage: call it before reading or writing any DM thread (mirrors
        ``_load_room_for_user``)::

            _load_conversation_membership(cur, conversation_id, user_id)

    Used by: Missions 7, 8.
    """
    cur.execute(
        "SELECT id, user_a_id, user_b_id FROM dm_conversations WHERE id = %s",
        (conversation_id,),
    )
    convo = cur.fetchone()
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if user_id not in (convo["user_a_id"], convo["user_b_id"]):
        raise HTTPException(
            status_code=403,
            detail="You are not a participant in this conversation",
        )
    return convo


def _fetch_conversation(cur, conversation_id: int, user_id: int):
    """Load one conversation already shaped from ``user_id``'s point of view.

    Definition: resolves the *other* participant (``otherUserId`` /
        ``otherUserName``) with a ``CASE`` + JOIN and formats the row. Returns
        ``None`` if the conversation isn't found.
    Usage: in Mission 6, after find-or-create, return it::

            return _fetch_conversation(cur, conversation_id, user_id)

    Used by: Mission 6.
    """
    cur.execute(
        """SELECT c.id, u.id AS other_user_id, u.name AS other_user_name, c.created_at
           FROM dm_conversations c
           JOIN users u
             ON u.id = CASE WHEN c.user_a_id = %s THEN c.user_b_id ELSE c.user_a_id END
           WHERE c.id = %s""",
        (user_id, conversation_id),
    )
    row = cur.fetchone()
    return _format_conversation(row) if row else None


def _fetch_dm_message(cur, message_id: int) -> dict:
    """Re-select one DM message by id, as JSON.

    Definition: single-row SELECT + format, so an INSERT returns the history
        shape (same idea as ``_fetch_chat_message``).
    Usage: after ``INSERT ... RETURNING id``::

            return _fetch_dm_message(cur, cur.fetchone()["id"])

    Used by: Missions 7b, 8.
    """
    cur.execute(
        """SELECT id, conversation_id, sender_id, body, created_at, read_at
           FROM dm_messages WHERE id = %s""",
        (message_id,),
    )
    return _format_dm_message(cur.fetchone())


# ---------------------------------------------------------------------------
# Rooms
# ---------------------------------------------------------------------------

@router.get("/chat/rooms")
def list_chat_rooms(request: Request):
    """Mission 1 (DONE — your worked example) — the rooms this user can chat in.

    Read this as the template for Missions 2-8. Every REST endpoint is the same
    four steps:
        1. authenticate            -> _require_user(request)
        2. open a connection       -> with db() as conn: cur = conn.cursor()
        3. run ONE %s-parameterised query
        4. shape the rows to JSON  -> a _format_* helper
    """
    user_id = _require_user(request)                     # 1. auth (401 if logged out)
    with db() as conn:                                   # 2. connection: auto commit + close
        cur = conn.cursor()
        # 3. One query returns the global room plus the caller's own district
        #    room. If the user's district_id is NULL the subquery yields NULL,
        #    which equals no district row — so they simply get the global room.
        cur.execute(
            """SELECT id, type, district_id, name
               FROM chat_rooms
               WHERE type = 'global'
                  OR district_id = (SELECT district_id FROM users WHERE id = %s)
               ORDER BY id""",
            (user_id,),
        )
        rooms = cur.fetchall()
    # 4. Shape each row into the camelCase JSON the frontend expects.
    return [_format_room(room) for room in rooms]


@router.get("/chat/rooms/{room_id}/messages")
from datetime import datetime, timezone
from flask import jsonify, g, request, abort
def list_room_messages(room_id):
    # 1. Session check (401)
    current_user = getattr(g, "user", None)
    if not current_user:
        return jsonify({"error": "Unauthorized"}), 401
    db = g.db
    cursor = db.cursor()

    # 2. Load the room to check permissions
    cursor.execute(
        "SELECT id, type, district_id FROM chat_rooms WHERE id = %s",
        (room_id,)
    )
    room = cursor.fetchone()
    if not room:
        return jsonify({"error": "Room not found"}), 404

    room_type = room["type"]
    room_district_id = room["district_id"]

    if room_type == "district" and room_district_id != current_user.get("district_id"):
        return jsonify({"error": "Forbidden: You cannot access other district chats"}), 403

    # 3. Query messages + sender names (with soft-delete filter and ASC order)
    query = """
            SELECT m.id, m.room_id, m.sender_id, u.name AS sender_name, m.body, m.created_at
            FROM chat_messages m
                     JOIN users u ON u.id = m.sender_id
            WHERE m.room_id = %s
              AND m.deleted_at IS NULL
            ORDER BY m.created_at ASC
                LIMIT 50 \
            """
    cursor.execute(query, (room_id,))
    rows = cursor.fetchall()

    # 4. Format the result list to camelCase and convert timestamps to ISO strings
    messages_payload = []
    for row in rows:
        dt = row["created_at"]
        if isinstance(dt, datetime):
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            iso_timestamp = dt.isoformat()
        else:
            iso_timestamp = str(dt)

        messages_payload.append({
            "id": row["id"],
            "roomId": row["room_id"],
            "senderId": row["sender_id"],
            "senderName": row["sender_name"],
            "body": row["body"],
            "createdAt": iso_timestamp
        })

    return jsonify(messages_payload), 200



from fastapi import APIRouter, Request, HTTPException, status
from pydantic import BaseModel, Field


class SendMessageBody(BaseModel):
    body: str = Field(..., max_length=2000)

@router.post(
    "/chat/rooms/{room_id}/messages",
    status_code=status.HTTP_201_CREATED
)
def send_room_message(room_id: int, body: SendMessageBody, request: Request):
    """Mission 3 — post a message into a room."""

    # 1. Read the current user from the session; 401 if not logged in
    user_id = request.session.get("user_id")
    user_district_id = request.session.get("district_id")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )


 .
    cleaned_body = body.body.strip()
    if not cleaned_body:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message body cannot be empty"
        )

    # 2. Validate the room like in Mission 2 (404 unknown, 403 wrong district).
    room = db.execute(
        "SELECT district_id FROM chat_rooms WHERE id = :room_id",
        {"room_id": room_id}
    ).fetchone()

    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found"
        )

    if room["district_id"] != user_district_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this district's room"
        )

    # 4. INSERT INTO chat_messages ... RETURNING *, and return the new message
    new_message = db.execute(
        """
        INSERT INTO chat_messages (room_id, user_id, body, created_at)
        VALUES (:room_id, :user_id, :body, NOW())
            RETURNING *
        """,
        {"room_id": room_id, "user_id": user_id, "body": cleaned_body}
    ).fetchone()
    return dict(new_message)
.")


# ---------------------------------------------------------------------------
# Direct messages
# ---------------------------------------------------------------------------

@router.get("/dms")
def list_dm_conversations(request: Request):
    """Mission 5 — this user's DM conversation list."""
    # TODO(student):
    # 1. Read the current user from the session; 401 if not logged in.
    # 2. Query dm_conversations where the user is user_a_id OR user_b_id.
    # 3. For each row, figure out who the *other* user is and JOIN users for
    #    their name (a CASE WHEN works, or do it in Python).
    # 4. Return a list of dicts shaped like:
    #      [{"id": 1, "otherUserId": 501, "otherUserName": "Sophia Lee",
    #        "createdAt": "..."}]
    # 5. Test: the seed gives user 1 two conversations (with users 501 and
    #    951) — log in as student001@test.edu and check both appear.
    return _todo(5, "implement listing this user's conversations from dm_conversations.")


@router.post("/dms/start")
def start_dm_conversation(body: StartDmBody, request: Request):
    """Mission 6 — start (or reuse) a conversation with another user."""
    # TODO(student):
    # 1. Read the current user from the session; 401 if not logged in.
    # 2. Validate body.toUserId: it must exist in users (404) and must not be
    #    yourself (400).
    # 3. Look for an existing conversation BETWEEN BOTH USERS — remember
    #    (me, them) and (them, me) are different rows to Postgres! If one
    #    exists, return it instead of inserting a duplicate.
    # 4. Otherwise INSERT INTO dm_conversations ... RETURNING *, and return it
    #    shaped like Mission 5's rows.
    # 5. Stretch goal: refuse to start a DM with someone who blocked you (or
    #    whom you blocked) — see the blocks table used by routers/reports.py.
    return _todo(6, "implement starting or reusing a DM conversation in dm_conversations.")


@router.get("/dms/{conversation_id}/messages")
def list_dm_messages(conversation_id: int, request: Request):
    """Mission 7a — message history for one conversation."""
    # TODO(student):
    # 1. Read the current user from the session; 401 if not logged in.
    # 2. Load the conversation (404 if missing) and check the current user is
    #    one of its two participants (403 if not) — DMs are private!
    # 3. Query dm_messages for the conversation, skipping deleted rows,
    #    ordered by created_at.
    # 4. Return a list of dicts shaped like:
    #      [{"id": 1, "conversationId": 1, "senderId": 1, "body": "...",
    #        "createdAt": "...", "readAt": null}]
    # 5. Stretch goal: set read_at = now() on the other user's unread rows,
    #    since fetching the thread means this user has now seen them.
    return _todo(7, f"implement loading messages for conversation {conversation_id} from dm_messages.")


@router.post("/dms/{conversation_id}/messages")
def send_dm_message(conversation_id: int, body: SendMessageBody, request: Request):
    """Mission 7b — send a private message."""
    # TODO(student):
    # 1. Read the current user from the session; 401 if not logged in.
    # 2. Same participant check as Mission 7a — never let a third user post
    #    into someone else's conversation.
    # 3. Validate body.body like Mission 3.
    # 4. INSERT INTO dm_messages ... RETURNING *, and return the new message
    #    (status code 201) shaped like Mission 7a's rows.
    # 5. Test: message yourself between two browser profiles (user 1 and
    #    user 501) and check both sides see the thread grow.
    return _todo(7, f"implement saving a new message to conversation {conversation_id} in dm_messages.")


# ---------------------------------------------------------------------------
# WebSockets — the "real-time" part (Missions 4 and 8)
#
# The REST endpoints above make chat *work* (with refresh/polling). WebSockets
# make it *live*: one long-lived connection per open chat window, and the
# server pushes every new message to everyone in the room the moment it
# arrives — no polling.
#
# For now each socket accepts, sends one TODO notice, and closes politely so
# nothing crashes. Your eventual implementation will need:
#   * auth: SessionMiddleware runs for WebSockets too, so
#     websocket.session.get("user_id") works just like request.session
#   * a connection registry, e.g. {room_id: [connected sockets]}
#   * a receive loop: async for text in websocket.iter_text()
#   * on each received message: validate + save it (reuse Mission 3's logic),
#     then send it to every socket registered for that room ("broadcast")
#   * cleanup: remove the socket from the registry on disconnect, even after
#     errors (try/finally), or you'll broadcast into dead connections.
# ---------------------------------------------------------------------------


@ws_router.websocket("/ws/chat/rooms/{room_id}")
async def chat_room_socket(websocket: WebSocket, room_id: int):
    """Mission 4 — live updates for a chat room. Not implemented yet."""
    # TODO(student): replace this placeholder with a real receive/broadcast
    # loop (see the block comment above, and Mission 4 in the guide).
    await websocket.accept()
    await websocket.send_json(
        _todo(4, f"implement the live WebSocket loop for room {room_id}.")
    )
    await websocket.close(code=1000)


@ws_router.websocket("/ws/dms/{conversation_id}")
async def dm_socket(websocket: WebSocket, conversation_id: int):
    """Mission 8 — live updates for a DM conversation. Not implemented yet."""
    # TODO(student): like Mission 4, but the registry key is conversation_id
    # and only its two participants may connect (close(code=4403) otherwise).
    await websocket.accept()
    await websocket.send_json(
        _todo(8, f"implement the live WebSocket loop for conversation {conversation_id}.")
    )
    await websocket.close(code=1000)
