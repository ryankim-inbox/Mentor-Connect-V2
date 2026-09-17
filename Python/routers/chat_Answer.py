# chat_Answer.py — REFERENCE SOLUTION (the "answer key" for chat.py)
#
# This is the finished version of the chat learning scaffold: every mission
# from docs/STUDENT_CHAT_BACKEND_GUIDE.md fully implemented, including the
# stretch goals (read receipts, block-aware DMs, canonical pair ordering).
# Compare it against your own work in routers/chat.py — don't just copy it.
#
# It is NOT wired into the app by default. main.py imports `chat`, so the
# student stub is what runs. To run this reference solution instead, change
# the import + include lines in Python/main.py from `chat` to `chat_Answer`:
#
#     from routers import ..., chat_Answer as chat
#
# (the router names `router` / `ws_router` below are identical, so nothing
# else in main.py has to change).
#
# Tables used (see Python/migrations/003_chat_learning_schema.sql):
#   chat_rooms, chat_messages, dm_conversations, dm_messages, plus users and
#   the blocks table from routers/reports.py.

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel

from db import db  # every query below runs through this context manager

# REST endpoints; main.py mounts this under /api (so: GET /api/chat/rooms).
router = APIRouter()

# WebSocket endpoints; mounted WITHOUT the /api prefix (so: /ws/chat/rooms/1).
ws_router = APIRouter()

# A single, generous ceiling for any message body (rooms and DMs alike).
MAX_MESSAGE_LEN = 2000


class SendMessageBody(BaseModel):
    body: str


class StartDmBody(BaseModel):
    toUserId: int


# ---------------------------------------------------------------------------
# Small shared helpers. The guide repeatedly says "you've written this twice,
# move it into a helper" — this is where those helpers live so every endpoint
# behaves identically.
# ---------------------------------------------------------------------------

def _require_user(request: Request) -> int:
    """Return the logged-in user's id, or raise 401. Mirrors auth.py/reports.py."""
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user_id


def _clean_body(raw: str) -> str:
    """Validate + normalise message text: no empty/whitespace, enforce a max length."""
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
    """chat_rooms row -> camelCase JSON the frontend expects (Mission 1)."""
    return {
        "id": row["id"],
        "type": row["type"],
        "districtId": row["district_id"],
        "name": row["name"],
    }


def _format_chat_message(row) -> dict:
    """chat_messages (+ sender name) row -> JSON (Missions 2, 3, 4)."""
    return {
        "id": row["id"],
        "roomId": row["room_id"],
        "senderId": row["sender_id"],
        "senderName": row["sender_name"],
        "body": row["body"],
        "createdAt": row["created_at"].isoformat(),
    }


def _format_conversation(row) -> dict:
    """dm_conversations (+ the *other* participant) row -> JSON (Missions 5, 6)."""
    return {
        "id": row["id"],
        "otherUserId": row["other_user_id"],
        "otherUserName": row["other_user_name"],
        "createdAt": row["created_at"].isoformat(),
    }


def _format_dm_message(row) -> dict:
    """dm_messages row -> JSON (Missions 7, 8). readAt is null until seen."""
    return {
        "id": row["id"],
        "conversationId": row["conversation_id"],
        "senderId": row["sender_id"],
        "body": row["body"],
        "createdAt": row["created_at"].isoformat(),
        "readAt": row["read_at"].isoformat() if row["read_at"] else None,
    }


def _load_room_for_user(cur, room_id: int, user_id: int) -> dict:
    """Fetch a room and enforce access: 404 if missing, 403 if it is another
    district's room. Shared by Missions 2, 3 and the WebSocket in Mission 4."""
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
    """Re-select a single room message JOINed with its sender's name, so
    inserts (Missions 3/4) return the exact same shape as the history query."""
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
    """Fetch a conversation and enforce privacy: 404 if missing, 403 if the
    current user is not one of the two participants. This is the single most
    important check in the project (see Mission 7)."""
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
    """Load one conversation already shaped from `user_id`'s point of view
    (otherUserId / otherUserName). Used by Mission 6 after find-or-create."""
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
    """Re-select a single DM message so inserts return the history shape."""
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
    """Mission 1 — the rooms this user can chat in (global + their district)."""
    user_id = _require_user(request)
    with db() as conn:
        cur = conn.cursor()
        # One query: the global room, plus the room whose district matches the
        # caller's own district. A NULL district_id user simply gets the global.
        cur.execute(
            """SELECT id, type, district_id, name
               FROM chat_rooms
               WHERE type = 'global'
                  OR district_id = (SELECT district_id FROM users WHERE id = %s)
               ORDER BY id""",
            (user_id,),
        )
        rooms = cur.fetchall()
    return [_format_room(room) for room in rooms]


@router.get("/chat/rooms/{room_id}/messages")
def list_room_messages(room_id: int, request: Request):
    """Mission 2 — message history for one room, oldest -> newest."""
    user_id = _require_user(request)
    with db() as conn:
        cur = conn.cursor()
        _load_room_for_user(cur, room_id, user_id)  # 404 / 403 guard
        cur.execute(
            """SELECT m.id, m.room_id, m.sender_id, u.name AS sender_name,
                      m.body, m.created_at
               FROM chat_messages m
               JOIN users u ON u.id = m.sender_id
               WHERE m.room_id = %s
                 AND m.deleted_at IS NULL      -- hide soft-deleted messages
               ORDER BY m.created_at
               LIMIT 50""",
            (room_id,),
        )
        messages = cur.fetchall()
    return [_format_chat_message(m) for m in messages]


@router.post("/chat/rooms/{room_id}/messages", status_code=201)
def send_room_message(room_id: int, body: SendMessageBody, request: Request):
    """Mission 3 — post a message into a room, return the saved row (201)."""
    user_id = _require_user(request)
    text = _clean_body(body.body)
    with db() as conn:
        cur = conn.cursor()
        _load_room_for_user(cur, room_id, user_id)  # same 404 / 403 guard
        cur.execute(
            """INSERT INTO chat_messages (room_id, sender_id, body)
               VALUES (%s, %s, %s) RETURNING id""",
            (room_id, user_id, text),
        )
        new_id = cur.fetchone()["id"]
        message = _fetch_chat_message(cur, new_id)  # re-select with sender name
    return message


# ---------------------------------------------------------------------------
# Direct messages
# ---------------------------------------------------------------------------

@router.get("/dms")
def list_dm_conversations(request: Request):
    """Mission 5 — this user's DM conversation list, newest first."""
    user_id = _require_user(request)
    with db() as conn:
        cur = conn.cursor()
        # The CASE in the JOIN condition resolves "the other person" whichever
        # column the caller sits in, so we never have to branch in Python.
        cur.execute(
            """SELECT c.id, u.id AS other_user_id, u.name AS other_user_name, c.created_at
               FROM dm_conversations c
               JOIN users u
                 ON u.id = CASE WHEN c.user_a_id = %s THEN c.user_b_id ELSE c.user_a_id END
               WHERE c.user_a_id = %s OR c.user_b_id = %s
               ORDER BY c.created_at DESC""",
            (user_id, user_id, user_id),
        )
        conversations = cur.fetchall()
    return [_format_conversation(c) for c in conversations]


@router.post("/dms/start")
def start_dm_conversation(body: StartDmBody, request: Request):
    """Mission 6 — start (or reuse) a conversation with another user."""
    user_id = _require_user(request)
    if body.toUserId == user_id:
        raise HTTPException(status_code=400, detail="Cannot start a DM with yourself")

    with db() as conn:
        cur = conn.cursor()

        cur.execute("SELECT id FROM users WHERE id = %s", (body.toUserId,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="User not found")

        # Stretch goal: refuse if either user has blocked the other.
        cur.execute(
            """SELECT 1 FROM blocks
               WHERE (blocker_id = %s AND blocked_user_id = %s)
                  OR (blocker_id = %s AND blocked_user_id = %s)
               LIMIT 1""",
            (user_id, body.toUserId, body.toUserId, user_id),
        )
        if cur.fetchone():
            raise HTTPException(
                status_code=403,
                detail="Cannot start a conversation with this user",
            )

        # Look up an existing conversation in EITHER stored order — legacy rows
        # may be (me, them) or (them, me).
        cur.execute(
            """SELECT id FROM dm_conversations
               WHERE (user_a_id = %s AND user_b_id = %s)
                  OR (user_a_id = %s AND user_b_id = %s)""",
            (user_id, body.toUserId, body.toUserId, user_id),
        )
        existing = cur.fetchone()
        if existing:
            return _fetch_conversation(cur, existing["id"], user_id)

        # New conversation: store the smaller id in user_a_id so future rows are
        # canonical and the UNIQUE(user_a_id, user_b_id) constraint prevents dups.
        a, b = min(user_id, body.toUserId), max(user_id, body.toUserId)
        cur.execute(
            "INSERT INTO dm_conversations (user_a_id, user_b_id) VALUES (%s, %s) RETURNING id",
            (a, b),
        )
        new_id = cur.fetchone()["id"]
        return _fetch_conversation(cur, new_id, user_id)


@router.get("/dms/{conversation_id}/messages")
def list_dm_messages(conversation_id: int, request: Request):
    """Mission 7a — message history for one conversation (participants only)."""
    user_id = _require_user(request)
    with db() as conn:
        cur = conn.cursor()
        _load_conversation_membership(cur, conversation_id, user_id)  # 404 / 403

        # Stretch goal (read receipts): fetching the thread means this user has
        # now seen the other person's messages, so stamp their unread rows.
        cur.execute(
            """UPDATE dm_messages
               SET read_at = now()
               WHERE conversation_id = %s
                 AND sender_id <> %s
                 AND read_at IS NULL""",
            (conversation_id, user_id),
        )

        cur.execute(
            """SELECT id, conversation_id, sender_id, body, created_at, read_at
               FROM dm_messages
               WHERE conversation_id = %s
                 AND deleted_at IS NULL          -- hide soft-deleted messages
               ORDER BY created_at""",
            (conversation_id,),
        )
        messages = cur.fetchall()
    return [_format_dm_message(m) for m in messages]


@router.post("/dms/{conversation_id}/messages", status_code=201)
def send_dm_message(conversation_id: int, body: SendMessageBody, request: Request):
    """Mission 7b — send a private message, return the saved row (201)."""
    user_id = _require_user(request)
    text = _clean_body(body.body)
    with db() as conn:
        cur = conn.cursor()
        _load_conversation_membership(cur, conversation_id, user_id)  # same guard
        cur.execute(
            """INSERT INTO dm_messages (conversation_id, sender_id, body)
               VALUES (%s, %s, %s) RETURNING id""",
            (conversation_id, user_id, text),
        )
        new_id = cur.fetchone()["id"]
        message = _fetch_dm_message(cur, new_id)
    return message


# ---------------------------------------------------------------------------
# WebSockets — the "real-time" part (Missions 4 and 8)
#
# REST already makes chat work via polling. WebSockets make it *live*: one
# long-lived connection per open chat window, and the server pushes every new
# message to everyone in the room the instant it is saved.
#
# The two registries below map a room / conversation id to the list of sockets
# currently connected to it. They live at module level so every connection
# shares them. (In-process only: fine for a single-worker dev server, which is
# what this scaffold targets.)
#
# Note: db() is a synchronous (psycopg2) helper. Calling it inside these async
# handlers briefly blocks the event loop; that is acceptable for a learning
# project. A production build would use an async driver or run_in_executor.
# ---------------------------------------------------------------------------

room_connections: dict[int, list[WebSocket]] = {}
dm_connections: dict[int, list[WebSocket]] = {}


async def _broadcast(sockets: list[WebSocket], message: dict) -> None:
    """Send `message` (as JSON) to every socket in the list, dropping any that
    have died so the next broadcast doesn't crash on a dead connection."""
    dead: list[WebSocket] = []
    for sock in list(sockets):
        try:
            await sock.send_json(message)
        except Exception:
            dead.append(sock)
    for sock in dead:
        if sock in sockets:
            sockets.remove(sock)


def _register(registry: dict[int, list[WebSocket]], key: int, websocket: WebSocket) -> None:
    registry.setdefault(key, []).append(websocket)


def _unregister(registry: dict[int, list[WebSocket]], key: int, websocket: WebSocket) -> None:
    """Remove a socket on disconnect, and forget empty rooms entirely."""
    sockets = registry.get(key)
    if sockets and websocket in sockets:
        sockets.remove(websocket)
    if sockets is not None and not sockets:
        registry.pop(key, None)


@ws_router.websocket("/ws/chat/rooms/{room_id}")
async def chat_room_socket(websocket: WebSocket, room_id: int):
    """Mission 4 — live updates for a chat room."""
    # SessionMiddleware runs for WebSockets too, so the login cookie is here.
    user_id = websocket.session.get("user_id")
    if not user_id:
        await websocket.close(code=4401)  # 4401 = our "unauthenticated" code
        return

    # Reuse the REST access rules before accepting: unknown room / wrong
    # district gets closed rather than connected.
    try:
        with db() as conn:
            _load_room_for_user(conn.cursor(), room_id, user_id)
    except HTTPException:
        await websocket.close(code=4403)  # 4403 = our "forbidden" code
        return

    await websocket.accept()
    _register(room_connections, room_id, websocket)
    try:
        async for text in websocket.iter_text():
            try:
                clean = _clean_body(text)
            except HTTPException:
                continue  # ignore empty / too-long input, keep the socket open

            # Persist first (same logic as Mission 3) ...
            with db() as conn:
                cur = conn.cursor()
                cur.execute(
                    """INSERT INTO chat_messages (room_id, sender_id, body)
                       VALUES (%s, %s, %s) RETURNING id""",
                    (room_id, user_id, clean),
                )
                message = _fetch_chat_message(cur, cur.fetchone()["id"])

            # ... then announce to everyone in the room, including the sender.
            await _broadcast(room_connections.get(room_id, []), message)
    except WebSocketDisconnect:
        pass
    finally:
        _unregister(room_connections, room_id, websocket)


@ws_router.websocket("/ws/dms/{conversation_id}")
async def dm_socket(websocket: WebSocket, conversation_id: int):
    """Mission 8 — live updates for a DM conversation (participants only)."""
    user_id = websocket.session.get("user_id")
    if not user_id:
        await websocket.close(code=4401)
        return

    # Same participant check as Mission 7 — outsiders are closed BEFORE any
    # private data can flow.
    try:
        with db() as conn:
            _load_conversation_membership(conn.cursor(), conversation_id, user_id)
    except HTTPException:
        await websocket.close(code=4403)
        return

    await websocket.accept()
    _register(dm_connections, conversation_id, websocket)
    try:
        async for text in websocket.iter_text():
            try:
                clean = _clean_body(text)
            except HTTPException:
                continue

            with db() as conn:
                cur = conn.cursor()
                cur.execute(
                    """INSERT INTO dm_messages (conversation_id, sender_id, body)
                       VALUES (%s, %s, %s) RETURNING id""",
                    (conversation_id, user_id, clean),
                )
                message = _fetch_dm_message(cur, cur.fetchone()["id"])

            # Registry is keyed by conversation_id, so only these two
            # participants' sockets ever receive the message.
            await _broadcast(dm_connections.get(conversation_id, []), message)
    except WebSocketDisconnect:
        pass
    finally:
        _unregister(dm_connections, conversation_id, websocket)
