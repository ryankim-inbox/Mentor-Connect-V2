"""Real HTTP/WS + PostgreSQL checks for the chat mission completion contract.

Run: sh scripts/test-python.sh tests/test_chat_integration.py -q
The runner creates its own loopback PostgreSQL cluster; each test creates and
drops its own database using the canonical schema and small data-only fixture.
"""

import json
import os
import socket
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import make_dsn
import pytest
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect


ROOT = Path(__file__).resolve().parent.parent


def test_backend_starts_with_declared_dependencies():
    result = subprocess.run(
        [sys.executable, "-c", "import main"],
        cwd=ROOT / "Python",
        env={**os.environ, "DATABASE_URL": "postgresql://tests@localhost/tests",
             "SESSION_SECRET": "chat-startup-test"},
        capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0, result.stderr


@pytest.fixture
def chat_database():
    admin_dsn = os.environ.get("CHAT_TEST_ADMIN_DSN")
    if not admin_dsn:
        pytest.skip("Set CHAT_TEST_ADMIN_DSN to run isolated PostgreSQL integration tests")
    name = "chat_test_" + uuid.uuid4().hex
    admin = psycopg2.connect(admin_dsn)
    admin.autocommit = True
    with admin.cursor() as cur:
        cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    dsn = make_dsn(admin_dsn, dbname=name)
    try:
        with closing(psycopg2.connect(dsn)) as conn, conn.cursor() as cur:
            cur.execute((ROOT / "database/schema/canonical.sql").read_text())
            cur.execute((ROOT / "tests/fixtures/chat-canonical.sql").read_text())
            conn.commit()
        yield dsn
    finally:
        with admin.cursor() as cur:
            cur.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
        admin.close()


@pytest.fixture
def chat_server(chat_database, tmp_path_factory):
    @contextmanager
    def running():
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        log_path = tmp_path_factory.mktemp("chat-server") / "server.log"
        with log_path.open("w+") as log:
            process = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1",
                 "--port", str(port), "--ws", "websockets-sansio"],
                cwd=ROOT / "Python", stdout=log, stderr=log,
                env={**os.environ, "DATABASE_URL": chat_database,
                     "SESSION_SECRET": "chat-integration-test", "NODE_ENV": "test"},
            )
            try:
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline and process.poll() is None:
                    try:
                        if api(build_opener(), base, "GET", "/api/healthz")[0] == 200:
                            break
                    except URLError:
                        time.sleep(0.05)
                else:
                    pytest.fail("Chat server failed to start:\n" + log_path.read_text())
                yield base
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
    return running


def api(client, base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = Request(base + path, data=data, method=method,
                      headers={"Content-Type": "application/json"})
    try:
        response = client.open(request, timeout=3)
    except HTTPError as exc:
        response = exc
    with response:
        payload = response.read().decode()
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            pass
        return response.status, payload


def login(base, email):
    jar = CookieJar()
    client = build_opener(HTTPCookieProcessor(jar))
    status, result = api(client, base, "POST", "/api/auth/login",
                         {"email": email, "password": "Password123!"})
    assert status == 200, result
    cookie = "; ".join(f"{item.name}={item.value}" for item in jar)
    return client, cookie


def test_concurrent_connect_has_exactly_one_winner(chat_server, chat_database):
    with chat_server() as base:
        author, _ = login(base, "student001@test.edu")
        mentor, _ = login(base, "mentor501@test.edu")
        other, _ = login(base, "both951@test.edu")
        anonymous = build_opener()
        status, created = api(author, base, "POST", "/api/requests", {
            "districtId": 1, "title": "Concurrent Connect", "description": "One match only",
            "role": "mentee",
        })
        assert status == 201 and created["authorId"] == 1
        request_id = created["id"]
        match_path = f"/api/requests/{request_id}/match"
        missing_path = "/api/requests/99999/match"
        for client, path, expected in [
            (author, match_path, 400), (anonymous, match_path, 401),
            (mentor, missing_path, 404),
        ]:
            assert api(client, base, "POST", path)[0] == expected
        _, unchanged = api(author, base, "GET", f"/api/requests/{request_id}")
        assert unchanged["status"] == "open" and unchanged["matchedUserId"] is None

        with closing(psycopg2.connect(chat_database)) as blocker, \
             closing(psycopg2.connect(chat_database)) as observer, \
             blocker.cursor() as lock_cursor, observer.cursor() as activity_cursor:
            observer.autocommit = True
            lock_cursor.execute("SELECT id FROM requests WHERE id = %s FOR UPDATE", (request_id,))
            with ThreadPoolExecutor(max_workers=2) as workers:
                callers = [(501, mentor), (951, other)]
                futures = [workers.submit(api, client, base, "POST", match_path)
                           for _, client in callers]
                try:
                    # Release only after both real backend transactions reach the held lock.
                    deadline = time.monotonic() + 2
                    while time.monotonic() < deadline:
                        activity_cursor.execute(
                            "SELECT count(*) FROM pg_stat_activity "
                            "WHERE datname = current_database() AND state = 'active' "
                            "AND wait_event_type = 'Lock' AND query LIKE %s",
                            (f"%requests%WHERE id = {request_id}%",),
                        )
                        if activity_cursor.fetchone()[0] == 2:
                            break
                        assert not any(future.done() for future in futures), "Connect finished before both lock waits"
                        time.sleep(0.01)
                    else:
                        pytest.fail("Both Connect transactions did not wait for the request lock")
                finally:
                    blocker.rollback()
                results = [future.result(timeout=3) for future in futures]

        assert sorted(status for status, _ in results) == [200, 400]
        successful_caller_id, successful_response = next(
            (user_id, response) for (user_id, _), (status, response) in zip(callers, results)
            if status == 200
        )
        status, stored_request = api(author, base, "GET", f"/api/requests/{request_id}")
        assert status == 200 and stored_request["status"] == "matched"
        assert stored_request["matchedUserId"] == successful_caller_id
        assert successful_response["matchedUserId"] == successful_caller_id
        for client, path, expected in [
            (author, match_path, 400), (anonymous, match_path, 401),
            (mentor, missing_path, 404), (mentor, match_path, 400), (other, match_path, 400),
        ]:
            assert api(client, base, "POST", path)[0] == expected
            _, stored_request = api(author, base, "GET", f"/api/requests/{request_id}")
            assert stored_request["matchedUserId"] == successful_caller_id


def test_rest_missions_privacy_validation_and_persistence(chat_server):
    with chat_server() as base:
        student, _ = login(base, "student001@test.edu")
        mentor, _ = login(base, "mentor501@test.edu")
        outsider, _ = login(base, "both951@test.edu")
        anonymous = build_opener()
        for method, path, body in [
            ("GET", "/api/chat/rooms", None),
            ("GET", "/api/chat/rooms/1/messages", None),
            ("POST", "/api/chat/rooms/1/messages", {"body": "hello"}),
            ("GET", "/api/dms", None),
            ("POST", "/api/dms/start", {"toUserId": 501}),
            ("GET", "/api/dms/1/messages", None),
            ("POST", "/api/dms/1/messages", {"body": "hello"}),
        ]:
            assert api(anonymous, base, method, path, body)[0] == 401, path
        status, rooms = api(student, base, "GET", "/api/chat/rooms")
        assert status == 200 and [r["id"] for r in rooms] == [1, 2]
        status, messages = api(student, base, "GET", "/api/chat/rooms/1/messages")
        assert status == 200 and len(messages) == 4
        assert all(m["senderName"] for m in messages)
        assert api(student, base, "GET", "/api/chat/rooms/3/messages")[0] == 403
        assert api(student, base, "GET", "/api/chat/rooms/99999/messages")[0] == 404
        status, conversations = api(mentor, base, "GET", "/api/dms")
        assert status == 200 and conversations[0]["otherUserId"] == 1
        for client, target in [(student, 501), (mentor, 1), (student, 501)]:
            status, conversation = api(client, base, "POST", "/api/dms/start", {"toUserId": target})
            assert status == 200 and conversation["id"] == 1
        new_ids = [api(student, base, "POST", "/api/dms/start", {"toUserId": 2})[1]["id"]
                   for _ in range(2)]
        assert new_ids[0] == new_ids[1]
        for target, expected in [(1, 400), (99999, 404), (502, 403)]:
            assert api(student, base, "POST", "/api/dms/start", {"toUserId": target})[0] == expected
        for method in ("GET", "POST"):
            body = {"body": "private"} if method == "POST" else None
            assert api(outsider, base, method, "/api/dms/1/messages", body)[0] == 403
            assert api(student, base, method, "/api/dms/99999/messages", body)[0] == 404
        for path in ("/api/dms/1/messages", "/api/chat/rooms/1/messages"):
            for body in ("", "   ", "x" * 2001):
                assert api(student, base, "POST", path, {"body": body})[0] == 400
        status, history = api(student, base, "GET", "/api/dms/1/messages")
        assert status == 200 and len(history) == 3
        assert all("readAt" in m for m in history)
        assert [m["createdAt"] for m in history] == sorted(m["createdAt"] for m in history)
        body = "x" * 2000
        status, sent = api(student, base, "POST", "/api/dms/1/messages", {"body": f"  {body}  "})
        assert status == 201 and sent["body"] == body and sent["senderId"] == 1
        assert sent["readAt"] is None and sent["conversationId"] == 1
        assert isinstance(sent["createdAt"], str)
        _, own_view = api(student, base, "GET", "/api/dms/1/messages")
        assert next(m for m in own_view if m["id"] == sent["id"])["readAt"] is None
        _, recipient_view = api(mentor, base, "GET", "/api/dms/1/messages")
        assert next(m for m in recipient_view if m["id"] == sent["id"])["readAt"] is not None
        status, room_sent = api(student, base, "POST", "/api/chat/rooms/1/messages", {"body": "  persistent room message  "})
        assert status == 201 and room_sent["body"] == "persistent room message"
    with chat_server() as base:
        student, _ = login(base, "student001@test.edu")
        for path, expected in [("/api/dms/1/messages", sent), ("/api/chat/rooms/1/messages", room_sent)]:
            status, history = api(student, base, "GET", path)
            assert status == 200
            assert any(m["id"] == expected["id"] and m["body"] == expected["body"] for m in history)


@pytest.mark.parametrize("path,other_path,history_path", [
    ("/ws/dms/1", "/ws/dms/2", "/api/dms/1/messages"),
    ("/ws/chat/rooms/1", "/ws/chat/rooms/2", "/api/chat/rooms/1/messages"),
])
def test_live_messages_are_private_validated_and_saved(chat_server, path, other_path, history_path):
    with chat_server() as base:
        student, student_cookie = login(base, "student001@test.edu")
        _, mentor_cookie = login(base, "mentor501@test.edu")
        _, outsider_cookie = login(base, "both951@test.edu")
        url = base.replace("http://", "ws://")
        rejected = [({}, path), ({"Cookie": outsider_cookie}, "/ws/dms/1"),
                    ({"Cookie": student_cookie}, "/ws/chat/rooms/3"),
                    ({"Cookie": student_cookie}, "/ws/dms/99999")]
        for headers, target in rejected:
            with pytest.raises(InvalidStatus) as error:
                with connect(url + target, additional_headers=headers, open_timeout=3):
                    pytest.fail("Unauthorized socket accepted")
            assert error.value.response.status_code == 403
        with connect(url + path, additional_headers={"Cookie": student_cookie}) as sender, \
             connect(url + path, additional_headers={"Cookie": mentor_cookie}) as recipient, \
             connect(url + other_path, additional_headers={"Cookie": student_cookie}) as other:
            for invalid in ("   ", "x" * 2001):
                sender.send(invalid)
            sender.send("  live integration message  ")
            confirmed = json.loads(sender.recv(timeout=3))
            assert confirmed["body"] == "live integration message" and confirmed["senderId"] == 1
            assert json.loads(recipient.recv(timeout=3)) == confirmed
            with pytest.raises(TimeoutError):
                other.recv(timeout=0.2)
            # A new peer still receives messages after another peer disconnects.
            recipient.close()
            with connect(url + path, additional_headers={"Cookie": mentor_cookie}) as reconnected:
                sender.send("after reconnect")
                again = json.loads(sender.recv(timeout=3))
                assert json.loads(reconnected.recv(timeout=3)) == again
        status, history = api(student, base, "GET", history_path)
        assert status == 200 and any(m["id"] == confirmed["id"] for m in history)
        assert not any(m["body"] in ("   ", "x" * 2001) for m in history)


@pytest.mark.parametrize("blocker_id", [1, 501])
def test_existing_dm_enforces_new_blocks(chat_server, chat_database, blocker_id):
    def message_count():
        with closing(psycopg2.connect(chat_database)) as conn, conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM dm_messages WHERE conversation_id = %s", (1,))
            return cur.fetchone()[0]

    with chat_server() as base:
        sender, sender_cookie = login(base, "student001@test.edu")
        recipient, recipient_cookie = login(base, "mentor501@test.edu")
        blocker = sender if blocker_id == 1 else recipient
        blocked_id = 501 if blocker_id == 1 else 1
        url = base.replace("http://", "ws://") + "/ws/dms/1"
        with connect(url, additional_headers={"Cookie": sender_cookie}, open_timeout=3) as sender_socket, \
             connect(url, additional_headers={"Cookie": recipient_cookie}, open_timeout=3) as recipient_socket:
            persisted_message_count_before = message_count()
            assert api(blocker, base, "POST", "/api/blocks", {"blockedUserId": blocked_id})[0] == 201
            assert api(sender, base, "POST", "/api/dms/1/messages", {"body": "blocked"})[0] == 403
            sender_socket.send("blocked")
            with pytest.raises(ConnectionClosed) as closed:
                sender_socket.recv(timeout=3)
            closed_code = closed.value.rcvd.code
            assert closed_code == 4403
            persisted_message_count_after = message_count()
            assert persisted_message_count_after == persisted_message_count_before
            recipient_received_blocked_message = False
            try:
                received = json.loads(recipient_socket.recv(timeout=0.2))
                recipient_received_blocked_message = received["body"] == "blocked"
            except TimeoutError:
                pass
            assert recipient_received_blocked_message is False
            assert api(sender, base, "GET", "/api/dms/1/messages")[0] == 200

            for cookie in (sender_cookie, recipient_cookie):
                with pytest.raises(InvalidStatus) as rejected:
                    with connect(url, additional_headers={"Cookie": cookie}, open_timeout=3):
                        pytest.fail("Blocked socket accepted")
                assert rejected.value.response.status_code == 403

            assert api(blocker, base, "DELETE", f"/api/blocks/{blocked_id}")[0] == 204
            status, restored = api(sender, base, "POST", "/api/dms/1/messages", {"body": "unblocked REST"})
            assert status == 201 and restored["body"] == "unblocked REST"
            with connect(url, additional_headers={"Cookie": sender_cookie}, open_timeout=3) as reconnected:
                reconnected.send("unblocked socket")
                confirmed = json.loads(reconnected.recv(timeout=3))
                assert confirmed["body"] == "unblocked socket"
                assert json.loads(recipient_socket.recv(timeout=3)) == confirmed
            assert message_count() == persisted_message_count_before + 2


def test_registration_names_cannot_poison_room_history(chat_server, chat_database):
    with chat_server() as base:
        client = build_opener(HTTPCookieProcessor(CookieJar()))
        registration = {"email": "new-student@test.edu", "password": "Password123!",
                        "role": "mentee", "districtId": 1}
        with closing(psycopg2.connect(chat_database)) as conn, conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM users")
            users_before = cur.fetchone()[0]
            for invalid in ("", "   ", "x" * 121, "한" * 41):
                assert api(client, base, "POST", "/api/auth/register", {**registration, "name": invalid})[0] == 422
                cur.execute("SELECT count(*) FROM users")
                assert cur.fetchone()[0] == users_before

        status, registered = api(client, base, "POST", "/api/auth/register",
                                 {**registration, "name": "  New Student  "})
        assert status == 201 and registered["user"]["name"] == "New Student"
        status, sent = api(client, base, "POST", "/api/chat/rooms/1/messages", {"body": "registered sender"})
        assert status == 201 and sent["senderName"] == "New Student"
        status, history = api(client, base, "GET", "/api/chat/rooms/1/messages")
        assert status == 200
        assert any(m["id"] == sent["id"] and m["senderName"] == "New Student" for m in history)
