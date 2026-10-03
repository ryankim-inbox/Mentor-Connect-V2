"""Real HTTP/WS + PostgreSQL checks for the chat mission completion contract.

Run: CHAT_TEST_ADMIN_DSN='dbname=postgres' .venv/bin/python -m pytest tests/test_chat_integration.py -q
The admin DSN must point to a LOCAL test server with CREATE DATABASE permission.
Each run creates and drops its own database; existing databases are never seeded.
"""

import json
import os
import socket
import subprocess
import sys
import time
import uuid
from contextlib import closing, contextmanager
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import make_dsn
import pytest
from websockets.exceptions import InvalidStatus
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
            cur.execute((ROOT / "database/mentor_connect_mock_1000.sql").read_text())
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


def test_districts_are_available_before_login(chat_server):
    with chat_server() as base:
        anonymous = build_opener()
        status, rows = api(anonymous, base, "GET", "/api/districts?type=high_school")
        assert status == 200
        assert len(rows) == 32
        assert all(row["type"] == "high_school" for row in rows)
        assert all({"id", "name", "county", "type", "memberCount",
                    "openRequestCount"} <= row.keys() for row in rows)
        status, rows = api(anonymous, base, "GET",
                           "/api/districts?type=high_school&search=zzzz_no_such_district")
        assert status == 200
        assert rows == []


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
