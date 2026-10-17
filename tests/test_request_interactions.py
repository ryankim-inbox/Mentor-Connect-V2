"""Consent, conversation discovery and comments against a real isolated DB."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from threading import Barrier
from uuid import uuid4

import psycopg2
import pytest
from backend_support import api, login


def create(client, base, title="E2E TEST consent"):
    status, row = api(client, base, "POST", "/api/requests", {
        "districtId": 1, "title": title, "description": "E2E TEST only", "role": "mentee",
    })
    assert status == 201
    return row["id"]


def test_application_requires_owner_acceptance_and_connect_alias_cannot_bypass(backend_server):
    with backend_server() as base:
        owner, _ = login(base, "student001@test.edu")
        mentor, _ = login(base, "mentor501@test.edu")
        rid = create(owner, base)
        path = f"/api/requests/{rid}"
        status, app = api(mentor, base, "POST", path + "/match")
        assert status == 200 and app["status"] == "pending"
        assert api(owner, base, "GET", path)[1]["status"] == "open"
        assert api(mentor, base, "POST", path + "/applications")[1]["id"] == app["id"]
        action = path + f'/applications/{app["id"]}'
        assert api(mentor, base, "PATCH", action, {"action": "accept"})[0] == 403
        assert api(owner, base, "PATCH", action, {"action": "accept"})[1]["status"] == "accepted"
        assert api(owner, base, "PATCH", action, {"action": "accept"})[1]["status"] == "accepted"
        matched = api(owner, base, "GET", path)[1]
        assert (matched["status"], matched["matchedUserId"]) == ("matched", 501)
        assert any(row["userId"] == 501 for row in api(owner, base, "GET", "/api/connections")[1])
        assert any(row["userId"] == 1 for row in api(mentor, base, "GET", "/api/connections")[1])
        assert any(row["id"] == rid for row in api(mentor, base, "GET", "/api/request-activity")[1])


def test_cancel_reapply_reject_and_application_privacy(backend_server):
    with backend_server() as base:
        owner, _ = login(base, "student001@test.edu")
        mentor, _ = login(base, "mentor501@test.edu")
        outsider, _ = login(base, "both951@test.edu")
        path = f"/api/requests/{create(owner, base)}"
        status, app = api(mentor, base, "POST", path + "/applications")
        assert status == 200 and app["status"] == "pending"
        action = path + f'/applications/{app["id"]}'
        assert api(outsider, base, "GET", path + "/applications")[1] == []
        assert api(outsider, base, "PATCH", action, {"action": "cancel"})[0] == 403
        assert api(owner, base, "PATCH", action, {"action": "cancel"})[0] == 403
        for _ in range(2):
            assert api(mentor, base, "PATCH", action, {"action": "cancel"})[1]["status"] == "cancelled"
        assert api(mentor, base, "POST", path + "/applications")[1]["status"] == "pending"
        for _ in range(2):
            assert api(owner, base, "PATCH", action, {"action": "reject"})[1]["status"] == "rejected"
        assert api(mentor, base, "POST", path + "/applications")[0] == 409
        assert api(owner, base, "GET", path)[1]["status"] == "open"


def test_competing_accepts_record_exactly_one_match(backend_database, backend_server):
    with backend_server() as base:
        owner, _ = login(base, "student001@test.edu")
        other_owner_session, _ = login(base, "student001@test.edu")
        applicants = [login(base, email)[0] for email in ("mentor501@test.edu", "both951@test.edu")]
        rid = create(owner, base)
        path = f"/api/requests/{rid}"
        apps = [api(c, base, "POST", path + "/applications")[1] for c in applicants]
        assert all(a.get("status") == "pending" for a in apps)
        barrier = Barrier(2)
        def accept(pair):
            client, app = pair
            barrier.wait(timeout=5)
            return api(client, base, "PATCH", path + f'/applications/{app["id"]}', {"action": "accept"})[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(accept, zip([owner, other_owner_session], apps)))
        assert sorted(statuses) == [200, 409]
        states = api(owner, base, "GET", path + "/applications")[1]
        assert sorted(a["status"] for a in states) == ["accepted", "rejected"]
        with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM request_events WHERE request_id=%s AND kind='matched'", (rid,))
            assert cur.fetchone()[0] == 1


def test_block_after_application_prevents_acceptance_and_contacts(backend_server):
    with backend_server() as base:
        owner, _ = login(base, "student001@test.edu")
        mentor, _ = login(base, "mentor501@test.edu")
        path = f"/api/requests/{create(owner, base)}"
        status, app = api(mentor, base, "POST", path + "/applications")
        assert status == 200
        assert api(owner, base, "POST", "/api/blocks", {"blockedUserId": 501})[0] == 201
        assert api(owner, base, "PATCH", path + f'/applications/{app["id"]}', {"action": "accept"})[0] == 403
        assert api(mentor, base, "POST", path + "/applications")[0] == 403
        assert not any(row["userId"] == 501 for row in api(owner, base, "GET", "/api/connections")[1])


def test_comments_replies_retries_and_cross_post_parent(backend_server):
    with backend_server() as base:
        owner, _ = login(base, "student001@test.edu")
        mentor, _ = login(base, "mentor501@test.edu")
        path = f"/api/requests/{create(owner, base)}/comments"
        text = {"body": "E2E TEST <script>plain text</script>", "clientCommentId": str(uuid4())}
        status, comment = api(mentor, base, "POST", path, text)
        assert status == 201
        assert api(mentor, base, "POST", path, text)[1]["id"] == comment["id"]
        assert api(mentor, base, "POST", path, {**text, "body": "changed"})[0] == 409
        reply_body = {"body": "E2E TEST reply", "parentId": comment["id"], "clientCommentId": str(uuid4())}
        status, reply = api(owner, base, "POST", path, reply_body)
        assert status == 201 and reply["parentId"] == comment["id"]
        assert api(owner, base, "POST", path, {**reply_body, "parentId": reply["id"], "clientCommentId": str(uuid4())})[0] == 400
        other = f"/api/requests/{create(owner, base)}/comments"
        assert api(owner, base, "POST", other, reply_body)[0] == 400
        rows = api(owner, base, "GET", path)[1]
        assert [row["id"] for row in rows] == [comment["id"], reply["id"]]
        assert api(owner, base, "POST", path, {"body": " ", "clientCommentId": str(uuid4())})[0] == 422
        assert api(owner, base, "POST", path, {"body": "x" * 2001, "clientCommentId": str(uuid4())})[0] == 422


def test_interaction_gateway_auth_bounds_and_sender_identity(gateway_server):
    from urllib.request import build_opener
    base = gateway_server
    owner, _ = login(base, "student001@test.edu")
    mentor, _ = login(base, "mentor501@test.edu")
    path = f"/api/requests/{create(owner, base)}"
    anon = build_opener()
    for method, suffix, body in [("GET", "/comments", None), ("POST", "/comments", {"body": "hi", "clientCommentId": str(uuid4())}),
                                 ("GET", "/applications", None), ("POST", "/applications", None),
                                 ("PATCH", "/applications/1", {"action": "accept"})]:
        assert api(anon, base, method, path + suffix, body)[0] == 401
    for endpoint in [path + "/comments", path + "/applications", "/api/connections", "/api/request-activity"]:
        assert api(anon, base, "GET", endpoint)[0] == 401
        for query in ["?limit=51", "?limit=0", "?beforeId=-1", "?beforeId=2147483648"]:
            assert api(owner, base, "GET", endpoint + query)[0] == 400
    assert api(mentor, base, "POST", path + "/comments", {"body": "actual sender", "authorId": 1, "clientCommentId": str(uuid4())})[0] == 422
    status, comment = api(mentor, base, "POST", path + "/comments", {"body": "actual sender", "clientCommentId": str(uuid4())})
    assert status == 201 and comment["authorId"] == 501
    status, app = api(mentor, base, "POST", path + "/applications")
    assert status == 200 and app["applicantId"] == 501
    assert api(mentor, base, "PATCH", path + f'/applications/{app["id"]}', {"action": "accept", "authorId": 1})[0] == 422
    assert api(mentor, base, "PATCH", path + f'/applications/{app["id"]}', {"action": "accept"})[0] == 403


def test_pagination_reopen_and_legacy_connections(backend_server, backend_database):
    with backend_server() as base:
        owner, _ = login(base, "student001@test.edu")
        mentor, _ = login(base, "mentor501@test.edu")
        ids = [create(owner, base, f"page {n}") for n in range(3)]
        path = f"/api/requests/{ids[-1]}"
        comments = [api(owner, base, "POST", path + "/comments", {"body": f"comment {n}", "clientCommentId": str(uuid4())})[1] for n in range(3)]
        assert [r["id"] for r in api(owner, base, "GET", path + "/comments?limit=2")[1]] == [c["id"] for c in comments[1:]]
        assert [r["id"] for r in api(owner, base, "GET", path + f'/comments?beforeId={comments[1]["id"]}')[1]] == [comments[0]["id"]]
        rows = api(owner, base, "GET", "/api/request-activity?limit=2")[1]
        assert [r["id"] for r in rows] == ids[:0:-1]
        assert api(owner, base, "GET", f'/api/request-activity?beforeId={rows[-1]["id"]}&limit=1')[1][0]["id"] == ids[0]
        app = api(mentor, base, "POST", path + "/applications")[1]
        action = path + f'/applications/{app["id"]}'
        assert api(owner, base, "PATCH", action, {"action": "accept"})[0] == 200
        assert api(owner, base, "PATCH", path, {"status": "open"})[0] == 200
        assert api(owner, base, "PATCH", action, {"action": "accept"})[0] == 409
        assert api(mentor, base, "POST", path + "/applications")[1]["status"] == "pending"
        assert api(owner, base, "PATCH", path, {"status": "closed"})[0] == 200
        assert api(mentor, base, "GET", path + "/applications")[1][0]["status"] == "cancelled"
        # A legacy match without an application remains a named connection.
        with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
            cur.execute("UPDATE requests SET status='matched', matched_user_id=501 WHERE id=%s", (ids[0],))
            conn.commit()
        connections = api(owner, base, "GET", "/api/connections")[1]
        assert any(c["userId"] == 501 and c["requestId"] == ids[0] and c["name"] for c in connections)
        assert api(owner, base, "POST", "/api/dms/start", {"toUserId": 501})[0] == 200


def test_blocked_comments_and_replies_recheck_each_retry(backend_server):
    with backend_server() as base:
        owner, _ = login(base, "student001@test.edu")
        mentor, _ = login(base, "mentor501@test.edu")
        path = f"/api/requests/{create(owner, base)}/comments"
        body = {"body": "before block", "clientCommentId": str(uuid4())}
        assert api(mentor, base, "POST", path, body)[0] == 201
        assert api(owner, base, "POST", "/api/blocks", {"blockedUserId": 501})[0] == 201
        assert api(mentor, base, "POST", path, body)[0] == 403
        assert api(mentor, base, "GET", path)[0] == 403
        assert api(owner, base, "GET", path)[1] == []
