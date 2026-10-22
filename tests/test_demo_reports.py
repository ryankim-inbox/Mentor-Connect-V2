"""Contextual student reports through real HTTP and disposable PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from threading import Barrier
from urllib.request import build_opener

import psycopg2
import pytest

from backend_support import api, login


def execute(dsn, statement, params=()):
    with closing(psycopg2.connect(dsn)) as conn, conn.cursor() as cur:
        cur.execute(statement, params)
        rows = cur.fetchall() if cur.description else None
        conn.commit()
        return rows


def make_request(dsn, author_id=501, title="Original reported request"):
    return execute(dsn, """INSERT INTO requests
        (author_id,district_id,title,description,role)
        VALUES (%s,1,%s,'Report context fixture','mentor') RETURNING id""",
        (author_id, title))[0][0]


def report_body(request_id=None, reported_user_id=501):
    body = {"reportedUserId": reported_user_id, "reason": "spam", "description": "First evidence"}
    if request_id is not None:
        body["requestId"] = request_id
    return body


@pytest.mark.parametrize("blocker,blocked", [(1, 501), (501, 1)])
@pytest.mark.parametrize("target_type", ["profile", "request"])
def test_reports_reject_blocks_in_either_direction(backend_database, backend_server, blocker, blocked, target_type):
    # Without the block check, an inaccessible target still creates moderation work.
    request_id = make_request(backend_database) if target_type == "request" else None
    execute(backend_database, "INSERT INTO blocks(blocker_id,blocked_user_id) VALUES (%s,%s)", (blocker, blocked))
    with backend_server() as base:
        reporter, _ = login(base, "student001@test.edu")
        status, result = api(reporter, base, "POST", "/api/reports", report_body(request_id))
        assert status == 403, result
    assert execute(backend_database, "SELECT count(*) FROM reports") == [(0,)]


@pytest.mark.parametrize("method,path,body", [
    ("POST", "/api/reports", report_body()),
    ("POST", "/api/blocks", {"blockedUserId": 501}),
    ("DELETE", "/api/blocks/502", None),
    ("GET", "/api/blocks", None),
])
def test_live_admin_promotion_revokes_student_report_and_block_access(backend_database, backend_server, method, path, body):
    # A valid old student session must lose write authority after its DB role changes.
    before_blocks = execute(backend_database, "SELECT * FROM blocks ORDER BY id")
    with backend_server() as base:
        client, _ = login(base, "student001@test.edu")
        execute(backend_database, "UPDATE users SET is_admin=true WHERE id=1")
        status, result = api(client, base, method, path, body)
        assert status == 403, result
    assert execute(backend_database, "SELECT count(*) FROM reports") == [(0,)]
    assert execute(backend_database, "SELECT * FROM blocks ORDER BY id") == before_blocks


@pytest.mark.parametrize("target_type", ["profile", "request"])
def test_unresolved_report_replay_returns_original_without_overwriting_evidence(backend_database, backend_server, target_type):
    # Removing target deduplication produces two rows or overwrites the first evidence.
    request_id = make_request(backend_database) if target_type == "request" else None
    with backend_server() as base:
        client, _ = login(base, "student001@test.edu")
        status, first = api(client, base, "POST", "/api/reports", report_body(request_id))
        assert status == 201, first
        status, replay = api(client, base, "POST", "/api/reports", {**report_body(request_id), "reason": "other", "description": "Later evidence"})
        assert status == 201, replay
    rows = execute(backend_database, "SELECT id,reason,description FROM reports")
    assert len(rows) == 1, rows
    assert rows[0][1:] == ("spam", "First evidence")
    assert replay == first == {"message": "Report submitted successfully"}


@pytest.mark.parametrize("target_type", ["profile", "request"])
def test_concurrent_report_replays_create_one_row(backend_database, backend_server, target_type):
    # A real delayed INSERT makes a select-before-insert race observable without mocks.
    request_id = make_request(backend_database) if target_type == "request" else None
    execute(backend_database, """CREATE FUNCTION delay_report_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END $$;
        CREATE TRIGGER report_insert_delay BEFORE INSERT ON reports
        FOR EACH ROW EXECUTE FUNCTION delay_report_insert()""")
    with backend_server() as base:
        clients = [login(base, "student001@test.edu")[0] for _ in range(6)]
        barrier = Barrier(len(clients))

        def submit(client):
            barrier.wait(timeout=3)
            return api(client, base, "POST", "/api/reports", report_body(request_id))

        with ThreadPoolExecutor(max_workers=len(clients)) as workers:
            results = list(workers.map(submit, clients))
    assert all(status == 201 for status, _ in results), results
    rows = execute(backend_database, "SELECT id FROM reports")
    assert len(rows) == 1, rows
    assert all(result == {"message": "Report submitted successfully"} for _, result in results)


@pytest.mark.parametrize("case,expected", [
    ("self_profile", 400), ("missing_profile", 404), ("self_request", 400),
    ("missing_request", 404), ("mismatched_author", 400), ("zero_request", 422),
    ("forged_title", 422), ("forged_target_type", 422),
])
def test_invalid_report_targets_do_not_write(backend_database, backend_server, case, expected):
    request_id = make_request(backend_database, author_id=1 if case == "self_request" else 501)
    bodies = {
        "self_profile": report_body(reported_user_id=1),
        "missing_profile": report_body(reported_user_id=99999),
        "self_request": report_body(request_id, reported_user_id=1),
        "missing_request": report_body(99999),
        "mismatched_author": report_body(request_id, reported_user_id=951),
        "zero_request": report_body(0),
        "forged_title": {**report_body(request_id), "requestTitle": "Invented title"},
        "forged_target_type": {**report_body(), "targetType": "request"},
    }
    with backend_server() as base:
        client, _ = login(base, "student001@test.edu")
        status, result = api(client, base, "POST", "/api/reports", bodies[case])
        assert status == expected, result
    assert execute(backend_database, "SELECT count(*) FROM reports") == [(0,)]


def test_profile_and_each_request_are_distinct_report_targets(backend_database, backend_server):
    # Deduplicating only by author would collapse reports about different content.
    first_request = make_request(backend_database)
    second_request = make_request(backend_database, title="Another request")
    with backend_server() as base:
        client, _ = login(base, "student001@test.edu")
        for request_id in (None, first_request, second_request):
            status, result = api(client, base, "POST", "/api/reports", report_body(request_id))
            assert status == 201, result
    assert execute(backend_database, "SELECT target_type,request_id,request_title FROM reports ORDER BY id") == [
        ("profile", None, None), ("request", first_request, "Original reported request"),
        ("request", second_request, "Another request"),
    ]


def test_request_context_survives_edits_and_deletion_with_admin_audit(backend_database, backend_server):
    # Request title is evidence captured by the server; deleting a post only removes its link.
    request_id = make_request(backend_database)
    execute(backend_database, "UPDATE users SET is_admin=true WHERE id=951")
    with backend_server() as base:
        client, _ = login(base, "student001@test.edu")
        admin, _ = login(base, "both951@test.edu")
        status, result = api(client, base, "POST", "/api/reports", report_body(request_id))
        assert status == 201, result
        execute(backend_database, "UPDATE requests SET title='Edited after report' WHERE id=%s", (request_id,))
        status, reports = api(admin, base, "GET", "/api/admin/reports")
        assert status == 200, reports
        report = reports[0]
        assert (report["targetType"], report["requestId"], report["requestTitle"]) == ("request", request_id, "Original reported request")
        path = f'/api/admin/reports/{report["id"]}'
        assert api(client, base, "GET", "/api/admin/reports")[0] == 403
        assert api(client, base, "PATCH", path, {"status": "resolved"})[0] == 403
        status, reviewed = api(admin, base, "PATCH", path, {"status": "reviewing", "note": "Preserve moderation evidence"})
        assert status == 200 and reviewed["reviewedBy"] == 951 and reviewed["reviewedAt"]
        execute(backend_database, "DELETE FROM requests WHERE id=%s", (request_id,))
        status, retained = api(admin, base, "PATCH", path, {"status": "resolved"})
        assert status == 200 and retained["status"] == "resolved"
        assert retained["targetType"] == "request" and retained["requestId"] is None
        assert retained["requestTitle"] == "Original reported request"
        assert retained["note"] == "Preserve moderation evidence"
        assert retained["description"] == "First evidence"
        assert api(admin, base, "PATCH", path, {"status": "dismissed", "note": None})[1]["note"] is None


def test_legacy_unicode_request_title_has_safe_bounded_report_snapshot(backend_database, backend_server):
    # Historical titles bypassed current byte validation; reporting must still work.
    title = "x" * 197 + "\U0001f600" * 20
    request_id = make_request(backend_database, title=title)
    execute(backend_database, "UPDATE users SET is_admin=true WHERE id=951")
    with backend_server() as base:
        reporter, _ = login(base, "student001@test.edu")
        admin, _ = login(base, "both951@test.edu")
        status, result = api(reporter, base, "POST", "/api/reports", report_body(request_id))
        assert status == 201, result
        status, reports = api(admin, base, "GET", "/api/admin/reports")
        assert status == 200 and len(reports) == 1
        assert reports[0]["requestTitle"] == "x" * 197
        assert reports[0]["requestId"] == request_id
    assert execute(backend_database, "SELECT request_title,octet_length(request_title) FROM reports") == [("x" * 197, 197)]
    assert execute(backend_database, "SELECT title FROM requests WHERE id=%s", (request_id,)) == [(title,)]


def test_existing_duplicate_audit_rows_are_preserved_and_resolved_targets_can_be_reported_again(backend_database, backend_server):
    # Legacy duplicates are not deleted; the oldest open/reviewing record is replayed.
    ids = execute(backend_database, """INSERT INTO reports(reporter_id,reported_user_id,reason,status,note)
        VALUES (1,501,'other','reviewing','Keep first'), (1,501,'spam','open','Keep second'),
               (1,501,'other','resolved','Old resolved'), (1,501,'other','dismissed','Old dismissed')
        RETURNING id""")
    before = execute(backend_database, "SELECT * FROM reports ORDER BY id")
    with backend_server() as base:
        client, _ = login(base, "student001@test.edu")
        status, replay = api(client, base, "POST", "/api/reports", report_body())
        assert status == 201 and replay == {"message": "Report submitted successfully"}, replay
        assert execute(backend_database, "SELECT * FROM reports ORDER BY id") == before
        execute(backend_database, "UPDATE reports SET status='resolved' WHERE status IN ('open','reviewing')")
        status, fresh = api(client, base, "POST", "/api/reports", report_body())
        assert status == 201, fresh
    assert execute(backend_database, "SELECT count(*) FROM reports") == [(5,)]
    assert execute(backend_database, "SELECT note FROM reports WHERE id=ANY(%s) ORDER BY id", ([row[0] for row in ids],)) == [
        ("Keep first",), ("Keep second",), ("Old resolved",), ("Old dismissed",),
    ]


def test_unverified_authenticated_member_can_report(backend_database, backend_server):
    with backend_server() as base:
        assert api(build_opener(), base, "POST", "/api/reports", report_body())[0] == 401
        client, _ = login(base, "student001@test.edu")
        execute(backend_database, "UPDATE users SET email_verified_at=NULL,is_verified=false WHERE id=1")
        assert api(client, base, "POST", "/api/reports", report_body())[0] == 201
    assert execute(backend_database, "SELECT count(*) FROM reports") == [(1,)]
