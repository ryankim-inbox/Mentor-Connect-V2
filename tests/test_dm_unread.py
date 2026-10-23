"""Durable unread state through real HTTP and a disposable PostgreSQL database."""
from contextlib import closing
from urllib.request import build_opener
from uuid import uuid4

import psycopg2

from backend_support import api, login


def unread(client, base, conversation_id):
    status, result = api(client, base, "GET", "/api/dms/unread")
    assert status == 200, result
    assert result["unreadCount"] == sum(row["unreadCount"] for row in result["conversations"])
    return next((row["unreadCount"] for row in result["conversations"]
                 if row["conversationId"] == conversation_id), 0)


def test_unread_counts_only_incoming_visible_unique_messages_and_explicit_reads(backend_server, backend_database):
    with backend_server() as base:
        sender, _ = login(base, "mentor501@test.edu")
        recipient, _ = login(base, "both951@test.edu")
        other_tab, _ = login(base, "both951@test.edu")
        outsider, _ = login(base, "student001@test.edu")
        _, conversation = api(sender, base, "POST", "/api/dms/start", {"toUserId": 951})
        conversation_id = conversation["id"]
        path = f"/api/dms/{conversation_id}"
        assert unread(recipient, base, conversation_id) == 0
        operation = {"body": "E2E TEST incoming", "clientMessageId": str(uuid4())}
        status, first = api(sender, base, "POST", path + "/messages", operation)
        assert status == 201
        assert api(sender, base, "POST", path + "/messages", operation)[1]["id"] == first["id"]
        assert unread(recipient, base, conversation_id) == 1
        assert unread(sender, base, conversation_id) == 0
        summary = api(recipient, base, "GET", "/api/dms/unread")[1]
        assert summary["unreadCount"] == 2  # One existing conversation plus this one.
        assert {row["conversationId"]: row["unreadCount"] for row in summary["conversations"]} == {2: 1, conversation_id: 1}
        # Prefetching or a hidden tab loading history must not clear the badge.
        assert api(recipient, base, "GET", path + "/messages")[1][0]["readAt"] is None
        assert unread(other_tab, base, conversation_id) == 1
        _, second = api(sender, base, "POST", path + "/messages", {"body": "arrived after render"})
        _, own = api(recipient, base, "POST", path + "/messages", {"body": "my reply"})
        for client, code in [(build_opener(), 401), (outsider, 403)]:
            assert api(client, base, "POST", path + "/read", {"messageIds": [first["id"]]})[0] == code
        for invalid in (0, -1, 2147483648, 1.5, "1", True):
            assert api(recipient, base, "POST", path + "/read", {"messageIds": [invalid]})[0] == 422
        for invalid in ([], [first["id"], first["id"]], list(range(1, 52)), None):
            assert api(recipient, base, "POST", path + "/read", {"messageIds": invalid})[0] == 422
        for invalid_id in (own["id"], 2147483647):
            assert api(recipient, base, "POST", path + "/read", {"messageIds": [invalid_id]})[0] == 404
            assert api(recipient, base, "POST", path + "/read", {"messageIds": [first["id"], invalid_id]})[0] == 404
        assert unread(recipient, base, conversation_id) == 2
        assert api(recipient, base, "POST", path + "/read", {"messageIds": [first["id"]]}) == (
            200, {"conversationId": conversation_id, "unreadCount": 1})
        assert unread(other_tab, base, conversation_id) == 1
        read_time = api(recipient, base, "GET", path + "/messages")[1][0]["readAt"]
        assert read_time is not None
        assert api(other_tab, base, "POST", path + "/read", {"messageIds": [second["id"]]})[1]["unreadCount"] == 0
        assert api(recipient, base, "POST", path + "/read", {"messageIds": [first["id"]]})[1]["unreadCount"] == 0
        assert api(recipient, base, "GET", path + "/messages")[1][0]["readAt"] == read_time
        assert unread(sender, base, conversation_id) == 1
        # Soft-deleted messages are never unread, and other conversations stay private.
        with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
            cur.execute("UPDATE dm_messages SET deleted_at = now() WHERE id = %s", (own["id"],))
            conn.commit()
        assert unread(sender, base, conversation_id) == 0
        assert all(row["conversationId"] != conversation_id for row in api(outsider, base, "GET", "/api/dms/unread")[1]["conversations"])
        assert api(build_opener(), base, "GET", "/api/dms/unread")[0] == 401


def test_late_commit_below_read_boundary_remains_unread(backend_server, backend_database):
    with backend_server() as base:
        sender, _ = login(base, "mentor501@test.edu")
        recipient, _ = login(base, "both951@test.edu")
        _, conversation = api(sender, base, "POST", "/api/dms/start", {"toUserId": 951})
        conversation_id = conversation["id"]
        path = f"/api/dms/{conversation_id}"
        with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
            cur.execute("INSERT INTO dm_messages (conversation_id, sender_id, body) VALUES (%s,501,'pending') RETURNING id", (conversation_id,))
            earlier_id = cur.fetchone()[0]
            _, rendered = api(sender, base, "POST", path + "/messages", {"body": "rendered"})
            assert earlier_id < rendered["id"]
            assert api(recipient, base, "POST", path + "/read", {"messageIds": [rendered["id"]]})[1]["unreadCount"] == 0
            conn.commit()
        assert unread(recipient, base, conversation_id) == 1
        assert api(recipient, base, "POST", path + "/read", {"messageIds": [rendered["id"]]})[1]["unreadCount"] == 1
        assert api(recipient, base, "POST", path + "/read", {"messageIds": [earlier_id]})[1]["unreadCount"] == 0


def test_lower_id_committing_between_history_and_acknowledgement_stays_unread(backend_server, backend_database):
    with backend_server() as base:
        sender, _ = login(base, "mentor501@test.edu")
        recipient, _ = login(base, "both951@test.edu")
        _, conversation = api(sender, base, "POST", "/api/dms/start", {"toUserId": 951})
        conversation_id = conversation["id"]
        path = f"/api/dms/{conversation_id}"
        with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
            cur.execute("INSERT INTO dm_messages (conversation_id, sender_id, body) VALUES (%s,501,'not in rendered snapshot') RETURNING id", (conversation_id,))
            earlier_id = cur.fetchone()[0]
            _, rendered = api(sender, base, "POST", path + "/messages", {"body": "rendered"})
            assert [row["id"] for row in api(recipient, base, "GET", path + "/messages")[1]] == [rendered["id"]]
            conn.commit()
        assert earlier_id < rendered["id"]
        for _ in range(2):
            assert api(recipient, base, "POST", path + "/read", {"messageIds": [rendered["id"]]})[1]["unreadCount"] == 1
        assert unread(recipient, base, conversation_id) == 1


def test_acknowledging_latest_page_does_not_read_unobserved_older_messages(backend_server, backend_database):
    with backend_server() as base:
        sender, _ = login(base, "mentor501@test.edu")
        recipient, _ = login(base, "both951@test.edu")
        _, conversation = api(sender, base, "POST", "/api/dms/start", {"toUserId": 951})
        conversation_id = conversation["id"]
        path = f"/api/dms/{conversation_id}"
        with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
            cur.execute("INSERT INTO dm_messages (conversation_id, sender_id, body) SELECT %s, 501, 'message ' || n FROM generate_series(1,60) n", (conversation_id,))
            conn.commit()
        assert unread(recipient, base, conversation_id) == 60
        snapshot = api(recipient, base, "GET", path + "/messages")[1]
        assert len(snapshot) == 50
        for _ in range(2):
            assert api(recipient, base, "POST", path + "/read", {"messageIds": [row["id"] for row in snapshot]})[1]["unreadCount"] == 10
        assert unread(recipient, base, conversation_id) == 10


def test_read_rejects_message_from_other_conversation_and_keeps_blocked_history_readable(backend_server):
    with backend_server() as base:
        sender, _ = login(base, "mentor501@test.edu")
        recipient, _ = login(base, "both951@test.edu")
        _, conversation = api(sender, base, "POST", "/api/dms/start", {"toUserId": 951})
        path = f'/api/dms/{conversation["id"]}'
        _, foreign = api(sender, base, "POST", "/api/dms/1/messages", {"body": "other conversation"})
        assert api(recipient, base, "POST", path + "/read", {"messageIds": [foreign["id"]]})[0] == 404
        _, message = api(sender, base, "POST", path + "/messages", {"body": "before block"})
        assert api(recipient, base, "POST", "/api/blocks", {"blockedUserId": 501})[0] == 201
        assert unread(recipient, base, conversation["id"]) == 1
        assert api(recipient, base, "POST", path + "/read", {"messageIds": [message["id"]]})[1]["unreadCount"] == 0
