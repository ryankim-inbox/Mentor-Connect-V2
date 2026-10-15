"""Reporting aggregates use UTC boundaries and real, privacy-projected module output."""
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import importlib
import json

import psycopg2
from psycopg2.extensions import make_dsn
import pytest

import db
import get_blocks
from backend_support import api, login


def execute(dsn, query, params=None):
    with closing(psycopg2.connect(dsn)) as conn, conn.cursor() as cur:
        cur.execute(query, params)
        conn.commit()


@pytest.mark.parametrize("now,timestamps,expected", [
    ("2025-01-01T00:30:00+00:00", ["2024-01-01T00:00:00Z", "2024-12-31T23:59:59Z", "2025-01-01T00:00:00Z"],
     {"today": 1, "thisMonth": 1, "thisYear": 1, "total": 3}),
    ("2024-03-01T00:30:00+00:00", ["2023-12-31T23:59:59Z", "2024-02-29T23:59:59Z", "2024-03-01T00:00:00Z"],
     {"today": 1, "thisMonth": 1, "thisYear": 2, "total": 3}),
    ("2025-12-31T23:30:00+00:00", ["2025-11-30T23:59:59Z", "2025-12-31T00:00:00Z", "2026-01-01T00:00:00Z"],
     {"today": 1, "thisMonth": 1, "thisYear": 2, "total": 3}),
    ("2025-05-02T00:30:00+00:00", ["2025-05-01T23:59:59Z", "2025-05-02T00:00:00Z", "2025-05-03T00:00:00Z"],
     {"today": 1, "thisMonth": 3, "thisYear": 3, "total": 3}),
    ("2025-05-02T00:30:00+00:00", ["2025-04-30T23:59:59Z", "2025-05-01T23:59:59Z", "2025-05-02T00:00:00Z"],
     {"today": 1, "thisMonth": 2, "thisYear": 3, "total": 3}),
])
def test_signup_utc_boundaries_and_real_sources(backend_database, monkeypatch, now, timestamps, expected):
    reports = importlib.import_module("reports")
    monkeypatch.setattr(db, "DATABASE_URL", backend_database)
    clock_calls = []
    def clock():
        clock_calls.append(True)
        return datetime.fromisoformat(now)
    monkeypatch.setattr(reports, "_utc_now", clock)
    execute(backend_database, "TRUNCATE users CASCADE")
    execute(backend_database, """INSERT INTO users (id, name, email, password_hash, role, district_id)
        SELECT n, 'Synthetic', 'signup' || n || '@test.edu', 'unused', 'mentee', 1
        FROM unnest(ARRAY[1, 2, 501]) AS n""")
    for user_id, created_at in zip([1, 2, 501], timestamps):
        execute(backend_database, "UPDATE users SET created_at = %s WHERE id = %s", (created_at, user_id))
    # Deliberately run the real query in a non-UTC database session.
    real_db = db.db
    @contextmanager
    def non_utc_db():
        with real_db() as conn:
            with conn.cursor() as cur:
                cur.execute("SET TIME ZONE 'America/Los_Angeles'")
            yield conn
    monkeypatch.setattr(reports, "db", non_utc_db)
    assert reports.signup_summary() == expected
    assert len(clock_calls) == 1
    assert reports.daily_count() == expected["today"]
    assert reports.monthly_count() == expected["thisMonth"]
    assert reports.yearly_count() == expected["thisYear"]
    execute(backend_database, "TRUNCATE users CASCADE")
    assert reports.signup_summary() == {"today": 0, "thisMonth": 0, "thisYear": 0, "total": 0}


def test_real_gateway_signup_summary_current_relative(gateway_server, backend_database):
    client, _ = login(gateway_server, "student001@test.edu")
    execute(backend_database, """UPDATE users SET created_at = CASE id
        WHEN 1 THEN date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        ELSE '2000-01-01T00:00:00Z'::timestamptz END""")
    status, result = api(client, gateway_server, "GET", "/api/python-reports/summary")
    assert status == 200 and result["ok"] and result["source"] == "student-module", result
    assert result["data"] == {"today": 1, "thisMonth": 1, "thisYear": 1, "total": 5}
    status, result = api(client, gateway_server, "GET", "/api/python-reports/status")
    assert status == 200 and result["ok"] and result["student_module"]["importable"], result


def test_count_blocks_counts_distinct_blockers_per_recipient():
    assert get_blocks.count_blocks([(1, 501), (1, 501), (2, 501), (501, 1)]) == {501: 2, 1: 1}
    assert get_blocks.count_blocks([]) == {}


def test_flagged_users_real_module_and_redaction(backend_database, gateway_server, monkeypatch):
    monkeypatch.setattr(db, "DATABASE_URL", backend_database)
    execute(backend_database, "DELETE FROM blocks")
    execute(backend_database, """INSERT INTO blocks (blocker_id, blocked_user_id)
        VALUES (1, 501), (2, 501), (501, 951)""")
    execute(backend_database, """INSERT INTO reports (reporter_id, reported_user_id, reason, created_at)
        SELECT 951, target, reason, '2025-01-01T00:00:00Z'::timestamptz + n * interval '1 minute'
        FROM (VALUES (1, 1, 'spam'), (2, 501, 'spam'), (3, 501, 'spam'),
          (4, 501, 'abuse'), (5, 502, 'spam'), (6, 502, 'spam'),
          (7, 502, 'spam'), (8, 502, 'abuse'), (9, 502, 'other')) AS r(n, target, reason)""")
    rows = get_blocks.get_flagged_users()
    by_id = {row["userId"]: row for row in rows}
    assert [(row["userId"], row["reportCount"], row["blockCount"], row["status"]) for row in rows] == [
        (502, 5, 0, "banned"), (501, 3, 2, "serious_warning"),
        (1, 1, 0, "warned"), (951, 0, 1, "active")]
    assert by_id[501]["topReasons"] == ["spam", "abuse"]
    assert datetime.fromisoformat(by_id[501]["lastReportedAt"]) == datetime(2025, 1, 1, 0, 4, tzinfo=timezone.utc)
    assert by_id[951]["lastReportedAt"] is None and by_id[951]["topReasons"] == []
    # Private module fields remain private behind the existing public projection.
    assert by_id[501]["email"] == "mentor501@test.edu" and by_id[501]["district"]
    client, _ = login(gateway_server, "student001@test.edu")
    status, result = api(client, gateway_server, "GET", "/api/admin/flagged-users")
    assert status == 200 and result["ok"] and result["source"] == "student-module", result
    assert set(result["data"][0]) == {"userId", "name", "reportCount", "blockCount", "status", "lastReportedAt", "topReasons"}
    assert "email" not in json.dumps(result) and "district" not in json.dumps(result)
    # The threshold is diagnostic: the highest-count user can still sign in.
    login(gateway_server, "santiago.khan.0502@test.edu")
    execute(backend_database, "DELETE FROM reports")
    execute(backend_database, "DELETE FROM blocks")
    assert get_blocks.get_flagged_users() == []
    status, result = api(client, gateway_server, "GET", "/api/admin/flagged-users")
    assert status == 200 and result["ok"] and result["data"] == [], result
    # Remove only task tables in this disposable database to force real SQL failures.
    execute(backend_database, "DROP TABLE reports")
    status, result = api(client, gateway_server, "GET", "/api/admin/flagged-users")
    assert status == 200 and result["ok"] is False and result["data"] is None, result
    assert result["error"] == "student_module_error"
    assert result["student_module"]["status"] == "runtime error"
    assert "Undefined" not in json.dumps(result)


def test_unavailable_reporting_database_is_explicit(backend_database, monkeypatch):
    from api.adapters import admin_adapter, reports_adapter
    monkeypatch.setattr(db, "DATABASE_URL", make_dsn(backend_database, dbname="task13_nonexistent_database"))
    for endpoint in [reports_adapter.get_signup_summary, admin_adapter.get_flagged_users]:
        result = endpoint()
        assert result["ok"] is False and result["data"] is None, result
        assert "OperationalError" in result["error"]
        assert result["student_module"]["status"] == "runtime error"
