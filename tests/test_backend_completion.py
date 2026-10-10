"""Release completion means healthy real modules composed through the gateway."""
from contextlib import closing
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, build_opener

import psycopg2

from backend_support import api, login


def test_active_python_sources_compile():
    root = Path(__file__).resolve().parents[1] / "Python"
    sources = sorted(path for path in root.rglob("*.py")
                     if not {".venv", "__pycache__"}.intersection(path.parts))
    assert sources
    for path in sources:
        compile(path.read_bytes(), str(path), "exec")


def test_completed_backend_flow_through_gateway(gateway_server, backend_database):
    base = gateway_server
    anonymous = build_opener()

    def call(client, method, path, body=None, expected=200):
        status, result = api(client, base, method, path, body)
        assert status == expected, (method, path, status, result)
        return result

    def module(path, source="python", *, status=False):
        result = call(student, "GET", path)
        assert result["ok"] is True and result["success"] is True, result
        assert result["source"] == source and result["error"] is None, result
        assert result["student_module"]["importable"] is True, result
        if not status:
            assert result["student_module"]["called"] is True, result
            assert result["student_module"]["status"] == "called", result
        return result["data"]

    def sql(query, params=None):
        with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall() if cur.description else None
            conn.commit()
            return rows

    assert {row["id"] for row in call(anonymous, "GET", "/api/districts")} == {1, 2}
    for role in ("mentee", "mentor"):
        client = build_opener(HTTPCookieProcessor(CookieJar()))
        result = call(client, "POST", "/api/auth/register", {
            "email": f"completion-{role}@test.edu", "name": f"Completion {role}",
            "password": "Password123!", "role": role, "districtId": 1,
        }, expected=201)
        assert result["user"]["role"] == role
        call(client, "POST", "/api/auth/logout")
        call(client, "GET", "/api/auth/me", expected=401)
    student, _ = login(base, "completion-mentee@test.edu")
    mentor, _ = login(base, "completion-mentor@test.edu")
    student_id = call(student, "GET", "/api/auth/me")["id"]
    mentor_id = call(mentor, "GET", "/api/auth/me")["id"]
    profile_path = f"/api/users/{student_id}"
    call(student, "PATCH", profile_path, {"bio": "Synthetic bio", "subjects": ["Math"]})
    call(student, "PATCH", profile_path, {"bio": ""})
    assert call(student, "GET", "/api/auth/me")["bio"] == ""
    assert sql("SELECT bio FROM users WHERE id = %s", (student_id,)) == [("",)]
    assert set(call(mentor, "GET", profile_path)) == {"id", "name", "subjects", "createdAt"}
    call(mentor, "PATCH", profile_path, {"bio": "Forbidden"}, expected=404)

    # Controlled actual database inputs for the learning algorithms, not success doubles.
    sql("UPDATE users SET available_times = NULL, subjects = '{}', location = NULL")
    sql("UPDATE users SET available_times = %s, location = 'Completion' WHERE id IN (%s, %s)",
        (["Mon 17:00", "Mon 17:00", "Wed 19:00"], student_id, mentor_id))
    sql("UPDATE users SET subjects = ARRAY['Math'] WHERE id = %s", (mentor_id,))
    sql("INSERT INTO questions (id, student_id, subject) VALUES (1, %s, 'Math')", (student_id,))

    request_body = {"districtId": 1, "title": "Completion request", "description": "Real gateway flow",
                    "role": "mentee", "tagIds": [1], "preferredTimes": ["Mon 17:00"]}
    first = call(student, "POST", "/api/requests", request_body, expected=201)
    second = call(student, "POST", "/api/requests", {**request_body, "title": "Second request"}, expected=201)
    other = call(student, "POST", "/api/requests", {**request_body, "districtId": 2}, expected=201)
    filters = {"districtId": 1, "role": "mentee", "status": "open", "tagId": 1, "limit": 1}
    page = call(student, "GET", "/api/requests?" + urlencode(filters))
    assert [row["id"] for row in page] == [second["id"]]
    cursor = f'{page[-1]["createdAt"]}|{page[-1]["id"]}'
    page = call(student, "GET", "/api/requests?" + urlencode({**filters, "before": cursor}))
    assert [row["id"] for row in page] == [first["id"]]
    path = f'/api/requests/{first["id"]}'
    assert call(student, "PATCH", path, {"title": "Edited request"})["title"] == "Edited request"
    call(student, "POST", "/api/requests", {**request_body, "title": " "}, expected=422)
    call(student, "PATCH", path, {"tagIds": [999999]}, expected=404)
    matched = call(mentor, "POST", path + "/match")
    assert matched["status"] == "matched" and matched["matchedUserId"] == mentor_id
    call(mentor, "POST", path + "/match", expected=400)
    assert sql("SELECT mentor_id FROM request_events WHERE kind = 'matched'") == [(mentor_id,)]

    # Every adapter must run the completed module and expose its actual nonempty data.
    for endpoint in ("/api/analysis/status", "/api/scheduling/status"):
        assert module(endpoint, status=True) is None
    assert module("/api/python-reports/status", "student-module", status=True) is None
    weekly = module("/api/analytics/weekly-matches")
    assert len(weekly) == 8 and weekly[-1]["matches"] == 1
    assert all(row["matches"] is None and row["coverage"] == "untracked" for row in weekly[:-1])
    subjects = module("/api/analytics/popular-subjects")
    assert subjects == [{"subject": "Math", "requests": 3, "color": "#3b82f6"}]
    slots = [{"slot": "Mon 17:00", "count": 2}, {"slot": "Wed 19:00", "count": 2}]
    assert module("/api/analytics/popular-time-slots") == slots
    assert module("/api/scheduling/overview") == {"topSlots": slots}
    suggestion = module(f"/api/scheduling/suggest?user_a={student_id}&user_b={mentor_id}")
    assert suggestion["overlap"] == ["Mon 17:00", "Wed 19:00"]
    assert set(suggestion["userA"]) == {"id", "name", "role", "available_times"}
    ranks = module("/api/analytics/mentor-response-rates")
    activity = next(row for row in ranks["mentors"] if row["mentorId"] == mentor_id)
    assert activity["totalMatches"] == 1 and activity["avgTimeToMatchHours"] >= 0
    assert module("/api/python-reports/summary", "student-module")["total"] == 7

    for endpoint in ("/api/practice/status", "/api/practice/locations/status", "/api/practice/blocks/status"):
        result = call(student, "GET", endpoint)
        assert result["success"] is True and result["status"] == "connected", result
        for engine in result.get("engines", {}).values():
            assert engine["success"] is True and engine["is_real"] is True and engine["is_todo"] is False, engine
    for name in ("find_matches", "locations", "get_blocks"):
        metadata = call(student, "GET", f"/api/practice/raw/{name}")
        assert metadata["success"] is True and metadata["is_real"] is True and metadata["is_todo"] is False
    for endpoint in ("/api/matches/1", "/api/practice/matching/1"):
        result = call(student, "GET", endpoint)
        assert result["success"] is True and result["is_real"] is True, result
        assert [row["mentor_id"] for row in result["matches"]] == [mentor_id]
    assert call(student, "POST", "/api/matches", {"question_id": 1})["success"] is True
    call(student, "POST", "/api/reports", {"reportedUserId": mentor_id, "reason": "spam"}, expected=201)
    call(student, "POST", "/api/blocks", {"blockedUserId": mentor_id}, expected=201)
    flagged = module("/api/admin/flagged-users", "student-module")
    row = next(row for row in flagged if row["userId"] == mentor_id)
    assert row["reportCount"] == 1 and row["blockCount"] == 1 and row["status"] == "warned"
    assert set(row) == {"userId", "name", "reportCount", "blockCount", "status", "lastReportedAt", "topReasons"}
    assert "email" not in str(flagged) and "district" not in str(flagged)
    assert call(student, "GET", "/api/blocks")[-1]["blockedUserId"] == mentor_id
    for endpoint in ("/api/matches/1", "/api/practice/matching/1"):
        result = call(student, "GET", endpoint)
        assert result["success"] is True and result["matches"] == [] and result["is_real"] is True, result
    call(student, "DELETE", f"/api/blocks/{mentor_id}", expected=204)
    assert call(student, "GET", "/api/matches/1")["matches"][0]["mentor_id"] == mentor_id

    for labels, expected in [([" San Jose ", "SAN JOSE"], {"compatible": True, "overlap": ["san jose"]}),
                             ([], {"compatible": False, "overlap": []})]:
        result = call(student, "POST", "/api/practice/locations/test", {
            "student": {"locations": labels}, "mentor": {"location": "san jose"}, "question": {},
        })
        assert result["success"] is True and result["is_real"] is True and result["is_todo"] is False
        assert result["result"] == expected

    rooms = call(student, "GET", "/api/chat/rooms")
    assert {room["id"] for room in rooms} == {1, 2}
    message = call(student, "POST", "/api/chat/rooms/1/messages", {"body": "Persistent completion room"}, expected=201)
    assert message["body"] == "Persistent completion room"
    assert any(row["id"] == message["id"] for row in call(mentor, "GET", "/api/chat/rooms/1/messages"))
    call(student, "GET", "/api/chat/rooms/3/messages", expected=403)
    call(student, "POST", "/api/chat/rooms/1/messages", {"body": " "}, expected=400)
    conversation = call(student, "POST", "/api/dms/start", {"toUserId": mentor_id})
    dm_path = f'/api/dms/{conversation["id"]}/messages'
    assert call(student, "GET", dm_path) == []
    sent = call(student, "POST", dm_path, {"body": "Persistent completion DM"}, expected=201)
    received = call(mentor, "GET", dm_path)
    assert len(received) == 1 and received[0]["id"] == sent["id"] and received[0]["readAt"] is not None
    assert any(row["id"] == conversation["id"] for row in call(student, "GET", "/api/dms"))
    outsider, _ = login(base, "mentor501@test.edu")
    call(outsider, "GET", dm_path, expected=403)
    call(student, "GET", "/api/dms/999999/messages", expected=404)
    call(student, "POST", dm_path, {"body": " "}, expected=400)
    call(student, "POST", "/api/blocks", {"blockedUserId": mentor_id}, expected=201)
    call(mentor, "POST", dm_path, {"body": "Blocked"}, expected=403)
    call(student, "DELETE", f"/api/blocks/{mentor_id}", expected=204)

    for request in (first, second, other):
        call(student, "DELETE", f'/api/requests/{request["id"]}', expected=204)
    assert call(student, "GET", "/api/requests") == []
    assert module("/api/analytics/popular-subjects") == []
    # Observation survives request deletion; do not reset the migration marker.
    assert module("/api/analytics/weekly-matches")[-1]["matches"] == 1
    assert sql("SELECT request_id, mentor_id FROM request_events WHERE kind = 'matched'") == [(None, mentor_id)]
    sql("DELETE FROM reports")
    sql("DELETE FROM blocks")
    sql("UPDATE users SET available_times = NULL")
    assert module("/api/admin/flagged-users", "student-module") == []
    assert module("/api/analytics/popular-time-slots") == []
    assert module("/api/scheduling/overview") == {"topSlots": []}
    assert module(f"/api/scheduling/suggest?user_a={student_id}&user_b={mentor_id}")["overlap"] == []
    # A synthetic empty observation window remains valid module data.
    sql("DELETE FROM request_events WHERE kind = 'matched'")
    assert module("/api/analytics/weekly-matches")[-1]["matches"] == 0
    assert all(row["totalMatches"] == 0 and row["avgTimeToMatchHours"] is None
               for row in module("/api/analytics/mentor-response-rates")["mentors"])
    sql("UPDATE users SET created_at = '2000-01-01T00:00:00Z'")
    assert module("/api/python-reports/summary", "student-module") == {"today": 0, "thisMonth": 0, "thisYear": 0, "total": 7}
    for client in (student, mentor, outsider):
        call(client, "POST", "/api/auth/logout")
        call(client, "GET", "/api/auth/me", expected=401)
