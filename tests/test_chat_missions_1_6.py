import asyncio
import subprocess
import sys
from collections import deque
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException, Request

from routers import chat


REPO_ROOT = Path(__file__).resolve().parent.parent
CHAT_PATH = REPO_ROOT / "Python" / "routers" / "chat.py"
STAMP = datetime(2026, 7, 1, 16, 0, tzinfo=timezone.utc)
_UNSET = object()


class QueryStep:
    def __init__(self, *contains, params=None, one=_UNSET, all_rows=_UNSET):
        self.contains = contains
        self.params = params
        self.one = one
        self.all_rows = all_rows


class ScriptedCursor:
    """Small psycopg2 boundary fake with strict SQL and parameter checks."""

    def __init__(self, steps):
        self.steps = deque(steps)
        self.current = None

    def execute(self, query, params=None):
        assert self.steps, f"Unexpected query: {query}"
        step = self.steps.popleft()
        normalized = " ".join(query.lower().split())
        for fragment in step.contains:
            assert " ".join(fragment.lower().split()) in normalized
        if step.params is not None:
            assert params == step.params
        self.current = step

    def fetchone(self):
        assert self.current is not None and self.current.one is not _UNSET
        return self.current.one

    def fetchall(self):
        assert self.current is not None and self.current.all_rows is not _UNSET
        return self.current.all_rows

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor

    def commit(self):
        pass


class FakeWebSocket:
    def __init__(self, session, incoming=()):
        self.session = session
        self.incoming = list(incoming)
        self.accepted = False
        self.close_codes = []
        self.sent_json = []

    async def accept(self):
        self.accepted = True

    async def close(self, code):
        self.close_codes.append(code)

    async def iter_text(self):
        for text in self.incoming:
            yield text

    async def send_json(self, message):
        self.sent_json.append(message)


def patch_db(monkeypatch, *steps):
    cursor = ScriptedCursor(steps)

    @contextmanager
    def fake_db():
        yield FakeConnection(cursor)

    monkeypatch.setattr(chat, "db", fake_db)
    return cursor


def request_for(user_id=None):
    session = {} if user_id is None else {"user_id": user_id}
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [],
            "session": session,
        }
    )


def room_socket_endpoint():
    return next(
        route.endpoint
        for route in chat.ws_router.routes
        if route.path == "/ws/chat/rooms/{room_id}"
    )


def dm_socket_endpoint():
    return next(
        route.endpoint
        for route in chat.ws_router.routes
        if route.path == "/ws/dms/{conversation_id}"
    )


def test_chat_router_is_valid_python():
    """A malformed mission must not prevent the entire API from starting."""
    result = subprocess.run(
        [sys.executable, "-m", "py_compile", str(CHAT_PATH)],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_chat_router_imports_in_the_python_backend_environment():
    """The router must use only dependencies available to the Python API."""
    result = subprocess.run(
        [sys.executable, "-c", "from routers import chat"],
        cwd=REPO_ROOT / "Python",
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_mission_1_lists_only_the_users_available_rooms(monkeypatch):
    cursor = patch_db(
        monkeypatch,
        QueryStep(
            "from chat_rooms",
            "type = 'global'",
            params=(1,),
            all_rows=[
                {"id": 1, "type": "global", "district_id": None, "name": "Global Chat"},
                {"id": 2, "type": "district", "district_id": 1, "name": "District Chat"},
            ],
        ),
    )

    result = chat.list_chat_rooms(request_for(1))

    assert result == [
        {"id": 1, "type": "global", "districtId": None, "name": "Global Chat"},
        {"id": 2, "type": "district", "districtId": 1, "name": "District Chat"},
    ]
    assert not cursor.steps


def test_mission_1_rejects_anonymous_users():
    with pytest.raises(HTTPException) as exc_info:
        chat.list_chat_rooms(request_for())

    assert exc_info.value.status_code == 401


def test_mission_2_returns_visible_room_history_in_frontend_shape(monkeypatch):
    cursor = patch_db(
        monkeypatch,
        QueryStep(
            "from chat_rooms",
            params=(1,),
            one={"id": 1, "type": "global", "district_id": None, "name": "Global Chat"},
        ),
        QueryStep(
            "from chat_messages",
            "join users",
            "deleted_at is null",
            "order by m.created_at",
            "limit 50",
            params=(1,),
            all_rows=[
                {
                    "id": 10,
                    "room_id": 1,
                    "sender_id": 501,
                    "sender_name": "Sophia Lee",
                    "body": "Hello",
                    "created_at": STAMP,
                }
            ],
        ),
    )

    result = chat.list_room_messages(1, request_for(1))

    assert result == [
        {
            "id": 10,
            "roomId": 1,
            "senderId": 501,
            "senderName": "Sophia Lee",
            "body": "Hello",
            "createdAt": "2026-07-01T16:00:00+00:00",
        }
    ]
    assert not cursor.steps


def test_mission_2_rejects_another_districts_room(monkeypatch):
    cursor = patch_db(
        monkeypatch,
        QueryStep(
            "from chat_rooms",
            params=(3,),
            one={"id": 3, "type": "district", "district_id": 2, "name": "Other District"},
        ),
        QueryStep(
            "select district_id from users",
            params=(1,),
            one={"district_id": 1},
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        chat.list_room_messages(3, request_for(1))

    assert exc_info.value.status_code == 403
    assert not cursor.steps


def test_mission_3_trims_persists_and_returns_the_saved_message(monkeypatch):
    cursor = patch_db(
        monkeypatch,
        QueryStep(
            "from chat_rooms",
            params=(1,),
            one={"id": 1, "type": "global", "district_id": None, "name": "Global Chat"},
        ),
        QueryStep(
            "insert into chat_messages (room_id, sender_id, body)",
            "returning id",
            params=(1, 1, "Stored message"),
            one={"id": 42},
        ),
        QueryStep(
            "from chat_messages",
            "join users",
            "where m.id = %s",
            params=(42,),
            one={
                "id": 42,
                "room_id": 1,
                "sender_id": 1,
                "sender_name": "Alex Kim",
                "body": "Stored message",
                "created_at": STAMP,
            },
        ),
    )

    result = chat.send_room_message(
        1,
        chat.SendMessageBody(body="  Stored message  "),
        request_for(1),
    )

    assert result == {
        "id": 42,
        "roomId": 1,
        "senderId": 1,
        "senderName": "Alex Kim",
        "body": "Stored message",
        "createdAt": "2026-07-01T16:00:00+00:00",
    }
    post_route = next(
        route
        for route in chat.router.routes
        if route.path == "/chat/rooms/{room_id}/messages" and "POST" in route.methods
    )
    assert post_route.status_code == 201
    assert not cursor.steps


@pytest.mark.parametrize("raw_body", ["   ", "x" * 2001])
def test_mission_3_rejects_invalid_message_bodies(raw_body):
    body = chat.SendMessageBody.model_construct(body=raw_body)

    with pytest.raises(HTTPException) as exc_info:
        chat.send_room_message(1, body, request_for(1))

    assert exc_info.value.status_code == 400


def test_mission_4_persists_and_broadcasts_a_formatted_room_message(monkeypatch):
    cursor = patch_db(
        monkeypatch,
        QueryStep(
            "from chat_rooms",
            params=(1,),
            one={"id": 1, "type": "global", "district_id": None, "name": "Global Chat"},
        ),
        QueryStep(
            "insert into chat_messages (room_id, sender_id, body)",
            params=(1, 1, "Live message"),
            one={"id": 43},
        ),
        QueryStep(
            "from chat_messages",
            "join users",
            params=(43,),
            one={
                "id": 43,
                "room_id": 1,
                "sender_id": 1,
                "sender_name": "Alex Kim",
                "body": "Live message",
                "created_at": STAMP,
            },
        ),
    )
    monkeypatch.setattr(chat, "room_connections", {})
    websocket = FakeWebSocket({"user_id": 1}, ["  Live message  "])

    asyncio.run(room_socket_endpoint()(websocket, 1))

    assert websocket.accepted is True
    assert websocket.close_codes == []
    assert websocket.sent_json == [
        {
            "id": 43,
            "roomId": 1,
            "senderId": 1,
            "senderName": "Alex Kim",
            "body": "Live message",
            "createdAt": "2026-07-01T16:00:00+00:00",
        }
    ]
    assert chat.room_connections == {}
    assert not cursor.steps


def test_mission_4_closes_anonymous_socket_before_accepting():
    websocket = FakeWebSocket({})

    asyncio.run(room_socket_endpoint()(websocket, 1))

    assert websocket.accepted is False
    assert websocket.close_codes == [4401]


def test_mission_4_closes_socket_for_another_district(monkeypatch):
    cursor = patch_db(
        monkeypatch,
        QueryStep(
            "from chat_rooms",
            params=(3,),
            one={"id": 3, "type": "district", "district_id": 2, "name": "Other District"},
        ),
        QueryStep(
            "select district_id from users",
            params=(1,),
            one={"district_id": 1},
        ),
    )
    websocket = FakeWebSocket({"user_id": 1})

    asyncio.run(room_socket_endpoint()(websocket, 3))

    assert websocket.accepted is False
    assert websocket.close_codes == [4403]
    assert not cursor.steps


def test_mission_5_lists_conversations_from_either_participant_position(monkeypatch):
    cursor = patch_db(
        monkeypatch,
        QueryStep(
            "u.name as other_user_name",
            "case when c.user_a_id = %s",
            "where c.user_a_id = %s or c.user_b_id = %s",
            "order by c.created_at desc",
            params=(1, 1, 1),
            all_rows=[
                {
                    "id": 2,
                    "other_user_id": 951,
                    "other_user_name": "Jordan Park",
                    "created_at": STAMP,
                },
                {
                    "id": 1,
                    "other_user_id": 501,
                    "other_user_name": "Sophia Lee",
                    "created_at": STAMP,
                },
            ],
        ),
    )

    result = chat.list_dm_conversations(request_for(1))

    assert result == [
        {
            "id": 2,
            "otherUserId": 951,
            "otherUserName": "Jordan Park",
            "createdAt": "2026-07-01T16:00:00+00:00",
        },
        {
            "id": 1,
            "otherUserId": 501,
            "otherUserName": "Sophia Lee",
            "createdAt": "2026-07-01T16:00:00+00:00",
        },
    ]
    assert not cursor.steps


def test_mission_6_reuses_an_existing_conversation(monkeypatch):
    cursor = patch_db(
        monkeypatch,
        QueryStep(
            "select id from users where id = %s",
            params=(501,),
            one={"id": 501},
        ),
        QueryStep(
            "from blocks",
            "blocked_user_id",
            params=(1, 501, 501, 1),
            one=None,
        ),
        QueryStep(
            "select id from dm_conversations",
            "user_a_id = %s and user_b_id = %s",
            "or (user_a_id = %s and user_b_id = %s)",
            params=(1, 501, 501, 1),
            one={"id": 7},
        ),
        QueryStep(
            "u.name as other_user_name",
            "where c.id = %s",
            params=(1, 7),
            one={
                "id": 7,
                "other_user_id": 501,
                "other_user_name": "Sophia Lee",
                "created_at": STAMP,
            },
        ),
    )

    result = chat.start_dm_conversation(
        chat.StartDmBody(toUserId=501),
        request_for(1),
    )

    assert result == {
        "id": 7,
        "otherUserId": 501,
        "otherUserName": "Sophia Lee",
        "createdAt": "2026-07-01T16:00:00+00:00",
    }
    assert not cursor.steps


def test_mission_6_creates_new_conversations_in_canonical_user_order(monkeypatch):
    cursor = patch_db(
        monkeypatch,
        QueryStep(
            "select id from users where id = %s",
            params=(1,),
            one={"id": 1},
        ),
        QueryStep(
            "from blocks",
            "blocked_user_id",
            params=(501, 1, 1, 501),
            one=None,
        ),
        QueryStep(
            "select id from dm_conversations",
            params=(501, 1, 1, 501),
            one=None,
        ),
        QueryStep(
            "insert into dm_conversations (user_a_id, user_b_id)",
            "returning id",
            params=(1, 501),
            one={"id": 8},
        ),
        QueryStep(
            "u.name as other_user_name",
            "where c.id = %s",
            params=(501, 8),
            one={
                "id": 8,
                "other_user_id": 1,
                "other_user_name": "Alex Kim",
                "created_at": STAMP,
            },
        ),
    )

    result = chat.start_dm_conversation(
        chat.StartDmBody(toUserId=1),
        request_for(501),
    )

    assert result == {
        "id": 8,
        "otherUserId": 1,
        "otherUserName": "Alex Kim",
        "createdAt": "2026-07-01T16:00:00+00:00",
    }
    assert not cursor.steps


def test_mission_6_rejects_a_dm_to_self():
    with pytest.raises(HTTPException) as exc_info:
        chat.start_dm_conversation(chat.StartDmBody(toUserId=1), request_for(1))

    assert exc_info.value.status_code == 400


def test_mission_6_rejects_an_unknown_target(monkeypatch):
    cursor = patch_db(
        monkeypatch,
        QueryStep(
            "select id from users where id = %s",
            params=(9999,),
            one=None,
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        chat.start_dm_conversation(chat.StartDmBody(toUserId=9999), request_for(1))

    assert exc_info.value.status_code == 404
    assert not cursor.steps


def test_mission_6_rejects_a_blocked_pair_with_403(monkeypatch):
    cursor = patch_db(
        monkeypatch,
        QueryStep(
            "select id from users where id = %s",
            params=(501,),
            one={"id": 501},
        ),
        QueryStep(
            "from blocks",
            "blocked_user_id",
            params=(1, 501, 501, 1),
            one={"exists": 1},
        ),
    )

    with pytest.raises(HTTPException) as exc_info:
        chat.start_dm_conversation(chat.StartDmBody(toUserId=501), request_for(1))

    assert exc_info.value.status_code == 403
    assert not cursor.steps


def test_mission_7_rest_endpoints_remain_todo():
    get_result = chat.list_dm_messages(7, request_for(1))
    post_result = chat.send_dm_message(
        7,
        chat.SendMessageBody(body="Still a TODO"),
        request_for(1),
    )

    assert get_result["status"] == "todo"
    assert get_result["mission"] == 7
    assert post_result["status"] == "todo"
    assert post_result["mission"] == 7


def test_mission_8_websocket_remains_todo():
    websocket = FakeWebSocket({"user_id": 1})

    asyncio.run(dm_socket_endpoint()(websocket, 7))

    assert websocket.accepted is True
    assert websocket.sent_json[0]["status"] == "todo"
    assert websocket.sent_json[0]["mission"] == 8
    assert websocket.close_codes == [1000]
