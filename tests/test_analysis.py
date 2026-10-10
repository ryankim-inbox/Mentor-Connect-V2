"""Observed events, rather than matched request snapshots, drive analytics."""
from contextlib import closing
from datetime import datetime, timezone

import psycopg2
import pytest

import analysis
import db
from backend_support import api, login

NOW = datetime(2025, 1, 20, 12, tzinfo=timezone.utc)


@pytest.fixture
def analytics_db(backend_database, monkeypatch):
    monkeypatch.setattr(db, "DATABASE_URL", backend_database)
    monkeypatch.setattr(analysis, "_utc_now", lambda: NOW, raising=False)
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("UPDATE request_events SET occurred_at = %s WHERE kind = 'tracking_started'",
                    ("2025-01-01T12:00:00Z",))
        conn.commit()
    return backend_database


def seed_events(dsn, events):
    with closing(psycopg2.connect(dsn)) as conn, conn.cursor() as cur:
        cur.executemany("""INSERT INTO request_events
            (kind, mentor_id, occurred_at, request_created_at)
            VALUES ('matched', %s, %s, %s)""", events)
        conn.commit()


def test_analytics_observation_coverage_and_latency(analytics_db):
    seed_events(analytics_db, [
        (501, "2025-01-01T12:00:00Z", "2025-01-01T10:00:00Z"),
        (501, "2025-01-05T23:59:59Z", "2025-01-05T19:59:59Z"),
        (951, "2025-01-06T00:00:00Z", "2025-01-07T00:00:00Z"),
        (None, "2025-01-20T00:00:00Z", "2025-01-19T00:00:00Z"),
        (501, "2024-12-31T12:00:00Z", "2024-12-31T10:00:00Z"),
        (501, "2025-01-20T13:00:00Z", "2025-01-20T10:00:00Z"),
    ])
    with closing(psycopg2.connect(analytics_db)) as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO requests (author_id, district_id, title, description,
            role, status, matched_user_id, created_at)
            VALUES (1, 1, 'Historical', 'Not observed', 'mentee', 'matched', 501, '2024-12-30')""")
        conn.commit()
    assert analysis.receive_weekly_matches() == [
        {"week": "2024-12-02", "matches": None, "coverage": "untracked"},
        {"week": "2024-12-09", "matches": None, "coverage": "untracked"},
        {"week": "2024-12-16", "matches": None, "coverage": "untracked"},
        {"week": "2024-12-23", "matches": None, "coverage": "untracked"},
        {"week": "2024-12-30", "matches": 2, "coverage": "partial"},
        {"week": "2025-01-06", "matches": 1, "coverage": "complete"},
        {"week": "2025-01-13", "matches": 0, "coverage": "complete"},
        {"week": "2025-01-20", "matches": 1, "coverage": "complete"},
    ]
    activity = analysis.receive_mentor_ranks()
    assert activity == {"trackingStartedAt": "2025-01-01T12:00:00+00:00", "mentors": [
        {"mentorId": 501, "mentorName": "Sophia Lee", "totalMatches": 2, "avgTimeToMatchHours": 3.0},
        {"mentorId": 951, "mentorName": "Jordan Park", "totalMatches": 1, "avgTimeToMatchHours": None},
        {"mentorId": 502, "mentorName": "Marcus Chen", "totalMatches": 0, "avgTimeToMatchHours": None},
    ]}
    assert analysis.response_time_analysis() == activity


def test_tracking_at_monday_is_complete_to_date_and_empty_is_valid(analytics_db):
    with closing(psycopg2.connect(analytics_db)) as conn, conn.cursor() as cur:
        cur.execute("UPDATE request_events SET occurred_at = %s", ("2025-01-20T00:00:00Z",))
        conn.commit()
    weekly = analysis.receive_weekly_matches()
    assert all(row["matches"] is None and row["coverage"] == "untracked" for row in weekly[:-1])
    assert weekly[-1] == {"week": "2025-01-20", "matches": 0, "coverage": "complete"}
    assert all(row["avgTimeToMatchHours"] is None and row["totalMatches"] == 0
               for row in analysis.receive_mentor_ranks()["mentors"])
    assert analysis.receive_most_popular_subject() == []


def test_popular_subjects_count_current_requests_and_break_ties_by_tag_id(analytics_db):
    with closing(psycopg2.connect(analytics_db)) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO tags (id, name, color) SELECT n, 'Tag ' || n, '#123456' FROM generate_series(2, 12) n")
        cur.execute("""INSERT INTO requests (id, author_id, district_id, title, description, role, status)
            VALUES (1, 1, 1, 'Need help', 'Test', 'mentee', 'open'),
                   (2, 501, 1, 'Offer help', 'Test', 'mentor', 'closed')""")
        cur.execute("INSERT INTO request_tags (request_id, tag_id) SELECT 1, n FROM generate_series(1,12) n")
        cur.execute("INSERT INTO request_tags (request_id, tag_id) VALUES (2,12)")
        conn.commit()
    assert analysis.receive_most_popular_subject() == [
        {"subject": "Tag 12", "requests": 2, "color": "#123456"},
        {"subject": "Math", "requests": 1, "color": "#3b82f6"},
        *[{"subject": f"Tag {n}", "requests": 1, "color": "#123456"} for n in range(2,10)],
    ]
    with closing(psycopg2.connect(analytics_db)) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM requests")
        conn.commit()
    assert analysis.receive_most_popular_subject() == []


def test_real_gateway_analytics_counts_both_directions_and_deleted_requests(gateway_server, backend_database):
    mentor, _ = login(gateway_server, "mentor501@test.edu")
    both, _ = login(gateway_server, "both951@test.edu")
    mentee, _ = login(gateway_server, "student001@test.edu")
    for author, role, matcher in [(mentee, "mentee", mentor), (both, "mentor", mentee)]:
        status, request = api(author, gateway_server, "POST", "/api/requests", {
            "title": "Observed", "description": "Synthetic analytics", "role": role,
            "districtId": 1, "tagIds": [1], "preferredTimes": [],
        })
        assert status == 201, request
        assert api(matcher, gateway_server, "POST", f"/api/requests/{request['id']}/match")[0] == 200
        assert api(author, gateway_server, "DELETE", f"/api/requests/{request['id']}")[0] == 204
    for path in ["weekly-matches", "popular-subjects", "mentor-response-rates"]:
        status, result = api(mentor, gateway_server, "GET", "/api/analytics/" + path)
        assert status == 200 and result["success"] and result["source"] == "python", result
        if path == "weekly-matches":
            assert len(result["data"]) == 8
            assert result["data"][-1]["matches"] == 2
            assert result["data"][-1]["coverage"] in ("partial", "complete")
            assert all(row["matches"] is None for row in result["data"][:-1])
        elif path == "popular-subjects":
            assert result["data"] == []
        else:
            assert [m["totalMatches"] for m in result["data"]["mentors"]] == [1, 1, 0]
            assert {m["mentorId"] for m in result["data"]["mentors"][:2]} == {501,951}
            assert all(m["avgTimeToMatchHours"] >= 0 for m in result["data"]["mentors"][:2])
