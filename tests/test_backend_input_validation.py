"""Product write contracts against real HTTP and disposable PostgreSQL."""
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
import time

import psycopg2
import pytest

from backend_support import api, login


REQUEST = {"districtId": 1, "title": "Algebra help", "description": "Quadratics",
           "role": "mentee", "tagIds": [1]}


def stored_product_rows(dsn):
    with closing(psycopg2.connect(dsn)) as conn, conn.cursor() as cur:
        rows = []
        for table in ("requests", "request_tags", "reports", "blocks"):
            cur.execute(f"SELECT * FROM {table} ORDER BY id")
            rows.append(cur.fetchall())
        return rows


@pytest.mark.parametrize("method,path,body,expected", [
    ("POST", "/api/requests", {**REQUEST, "role": "both"}, 422),
    ("POST", "/api/requests", {**REQUEST, "districtId": 0}, 422),
    ("POST", "/api/requests", {**REQUEST, "districtId": -1}, 422),
    ("POST", "/api/requests", {**REQUEST, "tagIds": [0]}, 422),
    ("POST", "/api/requests", {**REQUEST, "tagIds": [-1]}, 422),
    ("POST", "/api/requests", {**REQUEST, "tagIds": [1, 1]}, 422),
    ("POST", "/api/requests", {**REQUEST, "tagIds": list(range(1, 22))}, 422),
    ("POST", "/api/requests", {**REQUEST, "districtId": 99999}, 404),
    ("POST", "/api/requests", {**REQUEST, "tagIds": [1, 99999]}, 404),
    ("PATCH", "/api/requests/{id}", {"status": "invalid"}, 422),
    ("PATCH", "/api/requests/{id}", {"tagIds": [0]}, 422),
    ("PATCH", "/api/requests/{id}", {"tagIds": [-1]}, 422),
    ("PATCH", "/api/requests/{id}", {"tagIds": [1, 1]}, 422),
    ("PATCH", "/api/requests/{id}", {"tagIds": list(range(1, 22))}, 422),
    ("PATCH", "/api/requests/{id}", {"title": "Must roll back", "tagIds": [99999]}, 404),
    ("POST", "/api/reports", {"reportedUserId": 0, "reason": "spam"}, 422),
    ("POST", "/api/reports", {"reportedUserId": -1, "reason": "spam"}, 422),
    ("POST", "/api/reports", {"reportedUserId": 501, "reason": "invalid"}, 422),
    ("POST", "/api/reports", {"reportedUserId": 99999, "reason": "spam"}, 404),
    ("POST", "/api/reports", {"reportedUserId": 1, "reason": "spam"}, 400),
    ("POST", "/api/blocks", {"blockedUserId": 0}, 422),
    ("POST", "/api/blocks", {"blockedUserId": -1}, 422),
    ("POST", "/api/blocks", {"blockedUserId": 99999}, 404),
    ("POST", "/api/matches", {"question_id": 0}, 422),
    ("POST", "/api/matches", {"question_id": -1}, 422),
    ("POST", "/api/matches", {"question_id": 1, "limit": 0}, 422),
    ("POST", "/api/matches", {"question_id": 1, "limit": 21}, 422),
    ("GET", "/api/matches/0", None, 422),
    ("GET", "/api/matches/1?limit=21", None, 422),
    ("GET", "/api/requests/0", None, 422),
    ("PATCH", "/api/requests/-1", {"status": "closed"}, 422),
    ("DELETE", "/api/requests/0", None, 422),
    ("POST", "/api/requests/0/match", None, 422),
    ("DELETE", "/api/blocks/0", None, 422),
])
def test_invalid_product_writes_are_4xx(backend_server, backend_database,
                                      method, path, body, expected):
    # Removing boundary validation must either accept the write or expose a DB 500.
    with backend_server() as base:
        author, _ = login(base, "student001@test.edu")
        status, created = api(author, base, "POST", "/api/requests", REQUEST)
        assert status == 201, created
        before = stored_product_rows(backend_database)
        status, response = api(author, base, method, path.format(id=created["id"]), body)
        after = stored_product_rows(backend_database)
        assert after == before, "Rejected input changed stored product rows/tags"
        assert status == expected, response


def request_state(dsn, request_id):
    with closing(psycopg2.connect(dsn)) as conn, conn.cursor() as cur:
        cur.execute("SELECT status, matched_user_id, updated_at FROM requests WHERE id = %s",
                    (request_id,))
        return cur.fetchone()


def test_request_state_transition_contract(backend_server, backend_database):
    # PATCH cannot invent a match, keep a stale counterpart on reopen, or touch no-op timestamps.
    with backend_server() as base:
        author, _ = login(base, "student001@test.edu")
        mentor, _ = login(base, "mentor501@test.edu")
        status, created = api(author, base, "POST", "/api/requests", REQUEST)
        assert status == 201, created
        path = f"/api/requests/{created['id']}"
        initial = request_state(backend_database, created["id"])
        assert api(author, base, "PATCH", path, {"status": "matched"})[0] == 409
        assert request_state(backend_database, created["id"]) == initial
        assert api(mentor, base, "PATCH", path, {"status": "closed"})[0] == 403
        assert request_state(backend_database, created["id"]) == initial

        status, matched = api(mentor, base, "POST", path + "/match")
        assert status == 200 and matched["matchedUserId"] == 501
        connected = request_state(backend_database, created["id"])
        assert connected[:2] == ("matched", 501) and connected[2] > initial[2]
        status, retained = api(author, base, "PATCH", path, {"status": "matched"})
        assert status == 200 and retained["matchedUserId"] == 501
        assert request_state(backend_database, created["id"]) == connected
        assert api(mentor, base, "PATCH", path, {"status": "open"})[0] == 403
        assert request_state(backend_database, created["id"]) == connected

        status, closed = api(author, base, "PATCH", path, {"status": "closed"})
        assert status == 200 and closed["status"] == "closed"
        closed_state = request_state(backend_database, created["id"])
        assert closed_state[2] > connected[2]
        assert api(author, base, "PATCH", path, {"status": "closed"})[0] == 200
        assert request_state(backend_database, created["id"]) == closed_state
        assert api(author, base, "PATCH", path, {"status": "matched"})[0] == 409
        assert request_state(backend_database, created["id"]) == closed_state

        status, reopened = api(author, base, "PATCH", path, {"status": "open"})
        assert status == 200 and reopened["status"] == "open" and reopened["matchedUserId"] is None
        opened = request_state(backend_database, created["id"])
        assert opened[:2] == ("open", None) and opened[2] > closed_state[2]
        assert api(author, base, "PATCH", path, {"status": "open"})[0] == 200
        assert request_state(backend_database, created["id"]) == opened
        assert api(author, base, "DELETE", path)[0] == 204


def test_valid_product_write_boundaries(backend_server, backend_database):
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.executemany("INSERT INTO tags (id, name, color) VALUES (%s, %s, '#000000')",
                        [(i, f"Tag {i}") for i in range(2, 21)])
        conn.commit()
    with backend_server() as base:
        author, _ = login(base, "student001@test.edu")
        status, created = api(author, base, "POST", "/api/requests",
                              {**REQUEST, "role": "mentor", "tagIds": list(range(1, 21))})
        assert status == 201 and len(created["tags"]) == 20
        status, updated = api(author, base, "PATCH", f"/api/requests/{created['id']}",
                              {"tagIds": [], "title": "New title"})
        assert status == 200 and updated["tags"] == [] and updated["title"] == "New title"
        for reason in ("spam", "harassment", "inappropriate", "fake_account", "other"):
            assert api(author, base, "POST", "/api/reports",
                       {"reportedUserId": 501, "reason": reason})[0] == 201
        assert api(author, base, "POST", "/api/blocks", {"blockedUserId": 501})[0] == 201
        assert api(author, base, "POST", "/api/blocks", {"blockedUserId": 501})[0] == 201
        assert api(author, base, "DELETE", "/api/blocks/501")[0] == 204


def test_patch_decides_transition_after_acquiring_request_lock(backend_server, backend_database):
    with backend_server() as base:
        author, _ = login(base, "student001@test.edu")
        status, created = api(author, base, "POST", "/api/requests", REQUEST)
        assert status == 201, created
        request_id = created["id"]
        with closing(psycopg2.connect(backend_database)) as blocker, \
             closing(psycopg2.connect(backend_database)) as observer, \
             blocker.cursor() as lock_cursor, observer.cursor() as activity_cursor:
            observer.autocommit = True
            lock_cursor.execute("SELECT id FROM requests WHERE id = %s FOR UPDATE", (request_id,))
            with ThreadPoolExecutor(max_workers=1) as workers:
                pending = workers.submit(api, author, base, "PATCH", f"/api/requests/{request_id}",
                                         {"status": "matched"})
                try:
                    deadline = time.monotonic() + 2
                    while time.monotonic() < deadline:
                        activity_cursor.execute(
                            "SELECT count(*) FROM pg_stat_activity "
                            "WHERE datname = current_database() AND state = 'active' "
                            "AND wait_event_type = 'Lock' AND query LIKE %s",
                            (f"%requests%WHERE id = {request_id}%FOR UPDATE%",),
                        )
                        if activity_cursor.fetchone()[0] == 1:
                            break
                        assert not pending.done(), "PATCH decided from stale state before acquiring the lock"
                        time.sleep(0.01)
                    else:
                        pytest.fail("PATCH did not wait for the request lock")
                    # Simulate the Connect winner committing while PATCH waits for the same row.
                    lock_cursor.execute("UPDATE requests SET status = 'matched', matched_user_id = 501 "
                                        "WHERE id = %s", (request_id,))
                    blocker.commit()
                finally:
                    blocker.rollback()
                status, retained = pending.result(timeout=3)
        assert status == 200 and retained["status"] == "matched" and retained["matchedUserId"] == 501


@pytest.mark.parametrize("table,deleted_reference,method,path,body", [
    ("requests", "DELETE FROM districts WHERE id = 3", "POST", "/api/requests",
     {**REQUEST, "districtId": 3}),
    ("request_tags", "DELETE FROM tags WHERE id = 2", "POST", "/api/requests",
     {**REQUEST, "tagIds": [2]}),
    ("request_tags", "DELETE FROM tags WHERE id = 2", "PATCH", "/api/requests/{id}",
     {"title": "Must roll back", "tagIds": [2]}),
    ("reports", "DELETE FROM users WHERE id = 1001", "POST", "/api/reports",
     {"reportedUserId": 1001, "reason": "spam"}),
    ("blocks", "DELETE FROM users WHERE id = 1001", "POST", "/api/blocks",
     {"blockedUserId": 1001}),
])
def test_reference_disappearing_after_validation_is_404(backend_server, backend_database,
                                                       table, deleted_reference, method, path, body):
    # A real BEFORE trigger deterministically deletes the reference after prevalidation.
    with backend_server() as base:
        author, _ = login(base, "student001@test.edu")
        status, created = api(author, base, "POST", "/api/requests", REQUEST)
        assert status == 201, created
        with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
            cur.execute("INSERT INTO districts (id, name, county, type) VALUES (3, 'Race', 'Test', 'high_school')")
            cur.execute("INSERT INTO tags (id, name, color) VALUES (2, 'Race', '#000000')")
            cur.execute("INSERT INTO users (id, email, name, password_hash, role, district_id) "
                        "VALUES (1001, 'race@test.edu', 'Race', 'unused', 'mentor', 1)")
            cur.execute(f"CREATE FUNCTION remove_reference() RETURNS trigger LANGUAGE plpgsql AS $$ "
                        f"BEGIN {deleted_reference}; RETURN NEW; END $$")
            cur.execute(f"CREATE TRIGGER reference_race BEFORE INSERT ON {table} "
                        "FOR EACH ROW EXECUTE FUNCTION remove_reference()")
            conn.commit()
        before = stored_product_rows(backend_database)
        status, response = api(author, base, method, path.format(id=created["id"]), body)
        assert stored_product_rows(backend_database) == before
        assert status == 404, response


@pytest.mark.parametrize("failure", [
    "RAISE EXCEPTION 'unexpected database failure'",
    "RAISE EXCEPTION 'unrelated foreign key' USING ERRCODE = '23503', CONSTRAINT = 'requests_author_id_fkey'",
])
def test_unexpected_database_failure_is_not_a_user_error(backend_server, backend_database, failure):
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute(f"CREATE FUNCTION fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ "
                    f"BEGIN {failure}; END $$")
        cur.execute("CREATE TRIGGER failed_write BEFORE INSERT ON requests "
                    "FOR EACH ROW EXECUTE FUNCTION fail_write()")
        conn.commit()
    with backend_server() as base:
        author, _ = login(base, "student001@test.edu")
        before = stored_product_rows(backend_database)
        assert api(author, base, "POST", "/api/requests", REQUEST)[0] == 500
        assert stored_product_rows(backend_database) == before


def test_gateway_preserves_product_validation_statuses(gateway_server):
    author, _ = login(gateway_server, "student001@test.edu")
    assert api(author, gateway_server, "POST", "/api/requests", {**REQUEST, "role": "invalid"})[0] == 422
    assert api(author, gateway_server, "POST", "/api/requests", {**REQUEST, "tagIds": [99999]})[0] == 404
    status, created = api(author, gateway_server, "POST", "/api/requests", REQUEST)
    assert status == 201, created
    assert api(author, gateway_server, "PATCH", f"/api/requests/{created['id']}", {"status": "matched"})[0] == 409
