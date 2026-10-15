"""Recommendations enforce real block records and fail closed on lookup errors."""
from contextlib import closing

import psycopg2
import pytest

import db
from find_matches import find_matches
from get_blocks import receive_block_data
from backend_support import api, login


@pytest.fixture
def matching_database(backend_database, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", backend_database)
    monkeypatch.setattr(db, "DATABASE_URL", backend_database)
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("UPDATE users SET location = 'Test district' WHERE id IN (1, 501, 502)")
        cur.execute("UPDATE users SET subjects = ARRAY['Math'] WHERE id IN (501, 502)")
        cur.execute("UPDATE users SET languages = ARRAY['English'] WHERE id = 502")
        cur.execute("""INSERT INTO questions (id, student_id, subject, preferred_language)
                       VALUES (1, 1, 'Math', 'English')""")
        conn.commit()
    return backend_database


def matching_result(boundary, request):
    if boundary == "function":
        return find_matches(1, limit=1)
    base = request.getfixturevalue("gateway_server")
    client, _ = login(base, "student001@test.edu")
    status, result = api(client, base, "GET", "/api/matches/1?limit=1")
    assert status == 200, result
    return result


@pytest.mark.parametrize("boundary", ["function", "gateway"])
@pytest.mark.parametrize("pair", [(1, 502), (502, 1)])
def test_matching_filters_both_block_directions_before_limit(matching_database, boundary, pair, request):
    with closing(psycopg2.connect(matching_database)) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM blocks")
        conn.commit()
    # 502 has the extra language points and would otherwise occupy the only slot.
    unblocked = matching_result(boundary, request)
    assert unblocked["success"] is True, unblocked
    assert [match["mentor_id"] for match in unblocked["matches"]] == [502]
    with closing(psycopg2.connect(matching_database)) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO blocks (blocker_id, blocked_user_id) VALUES (%s, %s)", pair)
        conn.commit()
    result = matching_result(boundary, request)
    assert result["success"] is True, result
    assert [match["mentor_id"] for match in result["matches"]] == [501]
    assert result["matches"][0]["rank"] == 1


@pytest.mark.parametrize("boundary", ["function", "gateway"])
def test_matching_block_failure_is_not_success(matching_database, boundary, request):
    with closing(psycopg2.connect(matching_database)) as conn, conn.cursor() as cur:
        cur.execute("DROP TABLE blocks")
        conn.commit()
    result = matching_result(boundary, request)
    assert result["success"] is False, result
    assert result["matches"] == []
    assert result["status"] == "database error"
    assert result["is_real"] is False


def test_matching_uses_configured_database(matching_database):
    assert receive_block_data() == [(1, 502)]
    result = find_matches(1, limit=1)
    assert result["success"] is True, result
    assert [match["mentor_id"] for match in result["matches"]] == [501]
