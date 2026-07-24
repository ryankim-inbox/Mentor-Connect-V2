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

from fastapi import APIRouter, Request, WebSocket
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


# ---------------------------------------------------------------------------
# Rooms
# ---------------------------------------------------------------------------

@router.get("/chat/rooms")
def list_chat_rooms(request: Request):
    """Mission 1 — the rooms this user can chat in."""
    # TODO(student):
    # 1. Read the current user from the session; 401 if not logged in.
    user_id = session.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticatedf"
        )
    cursor=db.cursor()
    # 2. Look up the user's district_id from the users table.
    cursor.execute("SELECT district_id FROM users WHERE id = %s", (user_id,))
    user_row = cursor.fetchone()

    if not user_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    district_id = user_row["district_id"]
    # 3. Query chat_rooms for the global room AND this user's district room.
    query = """
        SELECT id, type, district_id, name
        FROM chat_rooms
        WHERE type = 'global' OR district_id = %s
        ORDER BY id \
    """
    cursor.execute(query, (district_id,))
    rooms = cursor.fetchall()

# 4. Return a list of dicts shaped like:
    response_data = []
    for room in rooms:
        response_data.append({
            "id": room["id"],
            "type": room["type"],
            "districtId": room["district_id"],
            "name": room["name"]
        })
    cursor.close()
    return response_data
    #      [{"id": 1, "type": "global", "districtId": None, "name": "Global Chat"}, ...]
    # 5. Test: curl with your login cookie, or the browser Network tab —
    #    the Global and My School tabs in the chat popup should stop showing
    #    the practice-task notice.
    return _todo(1, "implement loading this user's chat rooms from the chat_rooms table.")


@router.get("/chat/rooms/{room_id}/messages")
def list_room_messages(room_id: int, request: Request):
    """Mission 2 — message history for one room."""
    # TODO(student):
    # 1. Read the current user from the session; 401 if not logged in.
    # 2. Check the room exists (404 if not). For a 'district' room, also check
    #    it is the user's own district (403 if not).
    # 3. Query chat_messages JOIN users (for each sender's name), skipping
    #    rows WHERE deleted_at IS NOT NULL, ordered by created_at, e.g. the
    #    most recent 50.
    # 4. Return a list of dicts shaped like:
    #      [{"id": 1, "roomId": 1, "senderId": 1, "senderName": "Alex Kim",
    #        "body": "...", "createdAt": "2026-07-01T16:00:00+00:00"}, ...]
    #    (datetimes: use value.isoformat(), like format_user in auth.py does)
    # 5. Test: the seeded database already has 8 chat_messages — rooms 1 and 2
    #    should return some for user 1.
    return _todo(2, f"implement loading message history for room {room_id} from chat_messages.")


@router.post("/chat/rooms/{room_id}/messages")
def send_room_message(room_id: int, body: SendMessageBody, request: Request):
    """Mission 3 — post a message into a room."""
    # TODO(student):
    # 1. Read the current user from the session; 401 if not logged in.
    # 2. Validate the room like in Mission 2 (404 unknown, 403 wrong district).
    # 3. Validate body.body: reject empty/whitespace-only text (400); consider
    #    a max length (e.g. 2000 chars).
    # 4. INSERT INTO chat_messages ... RETURNING *, and return the new message
    #    in the same shape as Mission 2 (status code 201).
    # 5. Test: send from the chat popup input, then re-fetch Mission 2 and
    #    check your message is there — and that a plain `curl` without a
    #    session cookie gets a 401.
    return _todo(3, f"implement saving a new message to room {room_id} in chat_messages.")


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
