"""Observed Connect events share the real request transaction; history is never invented."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from threading import Barrier

import psycopg2
import pytest
from starlette.requests import Request

from backend_support import api, login


def events(dsn):
    with closing(psycopg2.connect(dsn)) as conn, conn.cursor() as cur:
        cur.execute("""SELECT kind, request_id, mentor_id, request_created_at, occurred_at
                       FROM request_events ORDER BY id""")
        return cur.fetchall()


@pytest.mark.parametrize("role,author_email,matcher_email", [
    ("mentee", "student001@test.edu", "mentor501@test.edu"),
    ("mentor", "mentor501@test.edu", "student001@test.edu"),
])
def test_match_event_is_atomic_and_role_attributed(backend_database, backend_server, role, author_email, matcher_email):
    with backend_server() as base:
        author, _ = login(base, author_email)
        matcher, _ = login(base, matcher_email)
        rival, _ = login(base, matcher_email)
        status, created = api(author, base, "POST", "/api/requests", {
            "districtId": 1, "title": "Observed match", "description": "No copied text", "role": role,
        })
        assert status == 201
        path = f'/api/requests/{created["id"]}'
        initial = events(backend_database)
        assert len(initial) == 1 and initial[0][:4] == ("tracking_started", None, None, None)
        barrier = Barrier(2)

        def connect(client):
            barrier.wait(timeout=5)
            return api(client, base, "POST", path + "/match")[0]

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(connect, [matcher, rival])) == [200, 400]
        first = events(backend_database)
        assert len(first) == 2
        assert first[1][:3] == ("matched", created["id"], 501)
        assert first[1][3].isoformat() == created["createdAt"]
        assert first[1][4] >= first[1][3]
        for _ in range(2):
            assert api(author, base, "GET", path)[0] == 200
            assert api(author, base, "PATCH", path, {"status": "matched"})[0] == 200
        assert events(backend_database) == first
        assert api(author, base, "PATCH", path, {"status": "open"})[1]["matchedUserId"] is None
        assert api(matcher, base, "POST", path + "/match")[0] == 200
        rematched = events(backend_database)
        assert len(rematched) == 3 and rematched[:2] == first
        assert rematched[2][:4] == first[1][:4]
        assert api(author, base, "DELETE", path)[0] == 204
        retained = events(backend_database)
        assert len(retained) == 3
        assert all(row[1] is None for row in retained)
        assert [row[2:] for row in retained] == [row[2:] for row in rematched]


def test_connect_rollback_removes_event_and_state(backend_database, monkeypatch):
    import db
    from routers import requests

    monkeypatch.setattr(db, "DATABASE_URL", backend_database)
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO requests (author_id, district_id, title, description, role)
                       VALUES (1, 1, 'Rollback', 'Detail', 'mentee') RETURNING id, updated_at""")
        request_id, updated_at = cur.fetchone()
        conn.commit()
    before = events(backend_database)

    def fail_after_insert(cur, row):
        cur.execute("SELECT count(*) FROM request_events WHERE request_id = %s", (request_id,))
        assert cur.fetchone()["count"] == 1
        raise RuntimeError("response failed after event insert")

    monkeypatch.setattr(requests, "build_request_response", fail_after_insert)
    with pytest.raises(RuntimeError, match="response failed after event insert"):
        requests.match_request(request_id, Request({"type": "http", "session": {"user_id": 501}}))
    assert events(backend_database) == before
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("SELECT status, matched_user_id, updated_at FROM requests WHERE id = %s", (request_id,))
        assert cur.fetchone() == ("open", None, updated_at)


def request_state(dsn, request_id):
    with closing(psycopg2.connect(dsn)) as conn, conn.cursor() as cur:
        cur.execute("SELECT status, matched_user_id, updated_at FROM requests WHERE id = %s", (request_id,))
        return cur.fetchone()


@pytest.mark.parametrize("role,author_email,matcher_email,author_id,matcher_id", [
    ("mentee", "student001@test.edu", "santiago.khan.0502@test.edu", 1, 502),
    ("mentor", "santiago.khan.0502@test.edu", "student001@test.edu", 502, 1),
])
@pytest.mark.parametrize("author_blocks", [True, False])
def test_gateway_connect_rejects_either_block_direction_until_unblocked(
    backend_database, gateway_server, role, author_email, matcher_email, author_id, matcher_id, author_blocks
):
    base = gateway_server
    author, _ = login(base, author_email)
    matcher, _ = login(base, matcher_email)
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM blocks")
        conn.commit()
    blocker, blocked_id = (author, matcher_id) if author_blocks else (matcher, author_id)
    assert api(blocker, base, "POST", "/api/blocks", {"blockedUserId": blocked_id})[0] == 201
    status, created = api(author, base, "POST", "/api/requests", {
        "districtId": 1, "title": "Blocked Connect", "description": "Keep this open", "role": role,
    })
    assert status == 201
    path = f'/api/requests/{created["id"]}/match'
    before = request_state(backend_database, created["id"])
    before_events = events(backend_database)
    status, response = api(matcher, base, "POST", path)
    assert (status, response) == (403, {"error": "forbidden"})
    assert request_state(backend_database, created["id"]) == before
    assert events(backend_database) == before_events
    assert api(blocker, base, "DELETE", f"/api/blocks/{blocked_id}")[0] == 204
    status, matched = api(matcher, base, "POST", path)
    assert status == 200 and matched["matchedUserId"] == matcher_id
    assert request_state(backend_database, created["id"])[:2] == ("matched", matcher_id)
    assert len(events(backend_database)) == len(before_events) + 1
    assert events(backend_database)[-1][:3] == ("matched", created["id"], 502)


def test_gateway_connect_block_lookup_failure_leaves_request_and_events_unchanged(backend_database, gateway_server):
    base = gateway_server
    author, _ = login(base, "student001@test.edu")
    matcher, _ = login(base, "mentor501@test.edu")
    status, created = api(author, base, "POST", "/api/requests", {
        "districtId": 1, "title": "Unavailable blocks", "description": "Fail closed", "role": "mentee",
    })
    assert status == 201
    before = request_state(backend_database, created["id"])
    before_events = events(backend_database)
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("DROP TABLE blocks")
        conn.commit()
    status, response = api(matcher, base, "POST", f'/api/requests/{created["id"]}/match')
    assert (status, response) == (500, {"error": "backend_error"})
    assert request_state(backend_database, created["id"]) == before
    assert events(backend_database) == before_events
