"""Bounded private history through the real gateway and disposable database."""
from contextlib import closing
from datetime import datetime, timezone
from urllib.request import build_opener

import psycopg2
import pytest

from backend_support import api, login


@pytest.fixture
def empty_conversation(backend_database):
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO dm_conversations (user_a_id, user_b_id) VALUES (%s, %s) RETURNING id",
            (501, 951),
        )
        conversation_id = cur.fetchone()[0]
        conn.commit()
    return conversation_id


def test_dm_history_bounded_visible_and_read_window(gateway_server, backend_database, empty_conversation):
    conversation_id = empty_conversation
    prior_read = datetime(2020, 1, 1, tzinfo=timezone.utc)
    ids = []
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        for number in range(270):
            cur.execute(
                "INSERT INTO dm_messages (conversation_id, sender_id, body, created_at, read_at) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (conversation_id, 951 if number % 2 == 0 else 501, "😀" * 2000,
                 "2030-01-01 00:00:00+00", prior_read if number in (2, 252) else None),
            )
            ids.append(cur.fetchone()[0])
        cur.execute(
            "INSERT INTO dm_messages (conversation_id, sender_id, body, created_at, deleted_at) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (conversation_id, 951, "Deleted newest message", "2030-01-02 00:00:00+00", "2030-01-03 00:00:00+00"),
        )
        deleted_id = cur.fetchone()[0]
        conn.commit()
        cur.execute("SELECT id, read_at FROM dm_messages")
        before = dict(cur.fetchall())

    member, _ = login(gateway_server, "mentor501@test.edu")
    path = f"/api/dms/{conversation_id}/messages"
    status, rows = api(member, gateway_server, "GET", path)
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("SELECT id, read_at FROM dm_messages")
        after = dict(cur.fetchall())

    expected_ids = ids[220:]
    expected_read_ids = set(ids[220::2]) - {ids[252]}
    changed_ids = {message_id for message_id in before if before[message_id] != after[message_id]}
    assert status == 200, f"Gateway status {status}; marked {len(changed_ids)} messages read instead of 24"
    assert len(rows) == 50
    assert [row["id"] for row in rows] == expected_ids
    assert deleted_id not in expected_ids
    assert changed_ids == expected_read_ids
    assert after[ids[2]] == after[ids[252]] == prior_read
    assert after[deleted_id] is None
    assert set(after) == set(before)
    for row in rows:
        actual_read = after[row["id"]]
        assert row["readAt"] == (actual_read.isoformat() if actual_read else None)
    assert [(row["createdAt"], row["id"]) for row in rows] == sorted(
        (row["createdAt"], row["id"]) for row in rows
    )
    assert api(member, gateway_server, "GET", path) == (200, rows)


@pytest.mark.parametrize("count", [0, 1, 49, 50, 51])
def test_dm_history_short_windows_and_unseen_read_receipts(gateway_server, backend_database, empty_conversation, count):
    ids = []
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        for number in range(count):
            cur.execute(
                "INSERT INTO dm_messages (conversation_id, sender_id, body, created_at) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (empty_conversation, 951, f"Message {number + 1}", "2030-01-01 00:00:00+00"),
            )
            ids.append(cur.fetchone()[0])
        conn.commit()

    member, _ = login(gateway_server, "mentor501@test.edu")
    outsider, _ = login(gateway_server, "student001@test.edu")
    path = f"/api/dms/{empty_conversation}/messages"
    assert api(build_opener(), gateway_server, "GET", path)[0] == 401
    assert api(outsider, gateway_server, "GET", path)[0] == 403
    assert api(member, gateway_server, "GET", "/api/dms/99999/messages")[0] == 404
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM dm_messages WHERE conversation_id = %s AND read_at IS NOT NULL", (empty_conversation,))
        assert cur.fetchone()[0] == 0
    status, rows = api(member, gateway_server, "GET", path)
    assert status == 200
    assert [row["id"] for row in rows] == ids[-50:]
    assert all(row["readAt"] is not None for row in rows)
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM dm_messages WHERE conversation_id = %s AND read_at IS NULL ORDER BY id", (empty_conversation,))
        assert [row[0] for row in cur.fetchall()] == ids[:-50]
        cur.execute("SELECT count(*) FROM dm_messages WHERE conversation_id = %s", (empty_conversation,))
        assert cur.fetchone()[0] == count
