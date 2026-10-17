"""Retries are scoped operations, never message-body deduplication."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest

from backend_support import api, login


def message_path(client, base, kind):
    if kind == "room":
        return "/api/chat/rooms/1/messages"
    status, conversation = api(client, base, "POST", "/api/dms/start", {"toUserId": 501})
    assert status == 200
    return f'/api/dms/{conversation["id"]}/messages'


@pytest.mark.parametrize("kind", ["room", "dm"])
def test_retry_returns_one_saved_message_and_conflicting_body_is_rejected(backend_server, kind):
    with backend_server() as base:
        client, _ = login(base, "student001@test.edu")
        path = message_path(client, base, kind)
        operation = {"body": "E2E TEST uncertain delivery", "clientMessageId": str(uuid4())}
        status, first = api(client, base, "POST", path, operation)
        assert status == 201
        status, replay = api(client, base, "POST", path, operation)
        assert status == 201 and replay["id"] == first["id"]
        assert api(client, base, "POST", path, {**operation, "body": "different"})[0] == 409
        status, history = api(client, base, "GET", path)
        assert status == 200
        assert [m["id"] for m in history if m["body"] == operation["body"]] == [first["id"]]
        # Intentional repetition is a different operation and remains allowed.
        assert api(client, base, "POST", path, {**operation, "clientMessageId": str(uuid4())})[1]["id"] != first["id"]


@pytest.mark.parametrize("kind", ["room", "dm"])
def test_concurrent_retries_have_one_identity(backend_server, kind):
    with backend_server() as base:
        clients = [login(base, "student001@test.edu")[0] for _ in range(2)]
        path = message_path(clients[0], base, kind)
        operation = {"body": "E2E TEST simultaneous retry", "clientMessageId": str(uuid4())}
        barrier = Barrier(2)
        def send(client):
            barrier.wait(timeout=5)
            return api(client, base, "POST", path, operation)
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(send, clients))
        assert [status for status, _ in responses] == [201, 201]
        assert len({row["id"] for _, row in responses}) == 1


def test_room_operation_ids_are_scoped_to_sender_and_room(backend_server):
    with backend_server() as base:
        student, _ = login(base, "student001@test.edu")
        mentor, _ = login(base, "mentor501@test.edu")
        body = {"body": "E2E TEST same operation identifier", "clientMessageId": str(uuid4())}
        rows = [api(client, base, "POST", path, body) for client, path in [
            (student, "/api/chat/rooms/1/messages"),
            (mentor, "/api/chat/rooms/1/messages"),
            (student, "/api/chat/rooms/2/messages"),
        ]]
        assert [status for status, _ in rows] == [201, 201, 201]
        assert len({row["id"] for _, row in rows}) == 3


def test_invalid_operation_key_rejected(backend_server):
    with backend_server() as base:
        client, _ = login(base, "student001@test.edu")
        assert api(client, base, "POST", "/api/chat/rooms/1/messages",
                   {"body": "hello", "clientMessageId": "not-a-uuid"})[0] == 422


@pytest.mark.parametrize("kind", ["room", "dm"])
def test_retry_does_not_broadcast_twice_and_rechecks_access(backend_server, backend_database, kind):
    import json
    from contextlib import closing
    import psycopg2
    from websockets.sync.client import connect
    with backend_server() as base:
        client, cookie = login(base, "student001@test.edu")
        path = "/api/chat/rooms/2/messages" if kind == "room" else message_path(client, base, kind)
        socket_path = path.replace("/api", "/ws").removesuffix("/messages")
        body = {"body": "E2E TEST one broadcast", "clientMessageId": str(uuid4())}
        with connect(base.replace("http://", "ws://") + socket_path, additional_headers={"Cookie": cookie}) as socket:
            first = api(client, base, "POST", path, body)
            assert first[0] == 201
            assert json.loads(socket.recv(timeout=3))["id"] == first[1]["id"]
            assert api(client, base, "POST", path, body)[1]["id"] == first[1]["id"]
            with pytest.raises(TimeoutError):
                socket.recv(timeout=0.25)
        if kind == "dm":
            assert api(client, base, "POST", "/api/blocks", {"blockedUserId": 501})[0] == 201
        else:
            with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
                cur.execute("UPDATE users SET district_id=2 WHERE id=1")
                conn.commit()
        assert api(client, base, "POST", path, body)[0] == 403
