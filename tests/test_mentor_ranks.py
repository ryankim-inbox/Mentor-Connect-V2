import asyncio
import importlib
import json
import os
from contextlib import closing, contextmanager
from urllib.request import build_opener

import pytest
from fastapi import FastAPI, HTTPException
from starlette.requests import Request
from backend_support import api, login


RANKS_MODULE = os.environ.get("MENTOR_RANKS_MODULE", "mentor_ranks_answer")
ranks = importlib.import_module(RANKS_MODULE)
student = importlib.import_module("mentor_ranks")


def request_with_session(user_id=None):
    session = {} if user_id is None else {"user_id": user_id}
    return Request({"type": "http", "method": "GET", "path": "/", "headers": [], "session": session})


def asgi_get_json(app, path, session):
    """Make one dependency-free ASGI HTTP request and return status/payload."""
    sent = []
    request_delivered = False

    async def receive():
        nonlocal request_delivered
        if request_delivered:
            return {"type": "http.disconnect"}
        request_delivered = True
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": [],
        "client": ("test", 123),
        "server": ("test", 80),
        "session": session,
    }
    asyncio.run(app(scope, receive, send))
    status = next(message["status"] for message in sent if message["type"] == "http.response.start")
    body = b"".join(message.get("body", b"") for message in sent if message["type"] == "http.response.body")
    return status, json.loads(body)


def test_scaffold_imports_with_all_lesson_interfaces():
    assert all(
        callable(getattr(student, name, None))
        for name in (
            "rank_data",
            "sort_mentors",
            "assign_ranks",
            "badge_for_rank",
            "list_mentor_ranks",
            "get_mentor_rank",
        )
    )


def test_require_user_success():
    assert student._require_user(request_with_session(42)) == 42


def test_require_user_missing_session():
    with pytest.raises(HTTPException) as exc:
        student._require_user(request_with_session())

    assert exc.value.status_code == 401
    assert exc.value.detail == "Not authenticated"


def test_scaffold_list_requires_authentication_before_query(monkeypatch):
    monkeypatch.setattr(student, "rank_data", lambda: pytest.fail("query must not run"))

    with pytest.raises(HTTPException) as exc:
        student.list_mentor_ranks(request_with_session())

    assert exc.value.status_code == 401


def test_scaffold_get_requires_authentication_before_query(monkeypatch):
    monkeypatch.setattr(student, "rank_data", lambda: pytest.fail("query must not run"))

    with pytest.raises(HTTPException) as exc:
        student.get_mentor_rank(0, request_with_session())

    assert exc.value.status_code == 401


def test_student_list_route_formats_stubbed_rank_data(monkeypatch):
    monkeypatch.setattr(
        student,
        "rank_data",
        lambda: [
            {"id": 7, "name": "Ada", "matched_count": 2},
            {"id": 8, "name": "Bo", "matched_count": 0},
        ],
    )
    app = FastAPI()
    app.include_router(student.router, prefix="/api")

    status, rows = asgi_get_json(app, "/api/mentor-ranks", {"user_id": 99})

    assert status == 200
    assert rows == [
        {"mentorId": 7, "mentorName": "Ada", "matchedCount": 2, "rank": 1, "badge": "Master"},
        {"mentorId": 8, "mentorName": "Bo", "matchedCount": 0, "rank": None, "badge": None},
    ]


def test_todo_helper_formats_an_unfinished_mission_independently_of_student_routes():
    assert student._todo(6, "Complete Mission 6 to return one mentor's global rank.") == {
        "status": "todo",
        "mission": 6,
        "message": "Complete Mission 6 to return one mentor's global rank.",
        "guide": "docs/STUDENT_MENTOR_RANKS_GUIDE.md",
    }


@pytest.mark.parametrize(("rank", "badge"), [(2, "Platinum"), (None, None)])
def test_student_public_row_uses_badge_thresholds_and_omits_private_fields(rank, badge):
    assert student._public_row(
        {"id": 7, "name": "Ada", "matched_count": 2, "rank": rank, "email": "private@test.edu"}
    ) == {
        "mentorId": 7,
        "mentorName": "Ada",
        "matchedCount": 2,
        "rank": rank,
        "badge": badge,
    }


def test_mission_2_sorts_counts_and_id_ties_without_mutation():
    rows = [
        {"id": 3, "name": "C", "matched_count": 3},
        {"id": 2, "name": "B", "matched_count": 5},
        {"id": 1, "name": "A", "matched_count": 3},
        {"id": 5, "name": "E", "matched_count": 0},
    ]

    result = ranks.sort_mentors(rows)

    assert [(row["id"], row["matched_count"]) for row in result] == [
        (2, 5),
        (1, 3),
        (3, 3),
        (5, 0),
    ]
    assert rows == [
        {"id": 3, "name": "C", "matched_count": 3},
        {"id": 2, "name": "B", "matched_count": 5},
        {"id": 1, "name": "A", "matched_count": 3},
        {"id": 5, "name": "E", "matched_count": 0},
    ]
    originals = {row["id"]: row for row in rows}
    assert all(row is not originals[row["id"]] for row in result)


def test_mission_2_returns_empty_sort_for_empty_input():
    assert ranks.sort_mentors([]) == []


def test_mission_3_assigns_competition_ranks_and_leaves_zeroes_unranked():
    rows = [
        {"id": 2, "name": "B", "matched_count": 5},
        {"id": 1, "name": "A", "matched_count": 3},
        {"id": 3, "name": "C", "matched_count": 3},
        {"id": 4, "name": "D", "matched_count": 1},
        {"id": 5, "name": "E", "matched_count": 0},
    ]

    result = ranks.assign_ranks(rows)

    assert [(row["id"], row["rank"]) for row in result] == [
        (2, 1),
        (1, 2),
        (3, 2),
        (4, 4),
        (5, None),
    ]
    assert all("rank" not in row for row in rows)


def test_mission_3_returns_empty_ranking_for_empty_input():
    assert ranks.assign_ranks([]) == []


@pytest.mark.parametrize(
    ("rank", "badge"),
    [
        (None, None),
        (0, None),
        (-1, None),
        (1, "Master"),
        (2, "Platinum"),
        (10, "Platinum"),
        (11, "Diamond"),
        (100, "Diamond"),
        (101, "Gold"),
        (500, "Gold"),
        (501, "Silver"),
        (1000, "Silver"),
        (1001, "Steel"),
        (2000, "Steel"),
        (2001, "Bronze"),
        (5000, "Bronze"),
        (5001, "Mud"),
        (10000, "Mud"),
        (10001, None),
    ],
)
def test_mission_4_maps_every_badge_boundary(rank, badge):
    assert ranks.badge_for_rank(rank) == badge


def test_mission_5_requires_authentication_before_query(monkeypatch):
    monkeypatch.setattr(ranks, "rank_data", lambda: pytest.fail("query must not run"))

    with pytest.raises(HTTPException) as exc:
        ranks.list_mentor_ranks(request_with_session())

    assert exc.value.status_code == 401


def test_mission_5_returns_only_ranked_public_fields(monkeypatch):
    monkeypatch.setattr(
        ranks,
        "rank_data",
        lambda: [
            {"id": 8, "name": "Zero", "matched_count": 0, "email": "private@test.edu"},
            {"id": 7, "name": "Top", "matched_count": 4, "email": "private@test.edu"},
        ],
    )

    assert ranks.list_mentor_ranks(request_with_session(99)) == [
        {"mentorId": 7, "mentorName": "Top", "matchedCount": 4, "rank": 1, "badge": "Master"},
        {"mentorId": 8, "mentorName": "Zero", "matchedCount": 0, "rank": None, "badge": None},
    ]


def test_mission_5_returns_empty_result(monkeypatch):
    monkeypatch.setattr(ranks, "rank_data", lambda: [])

    assert ranks.list_mentor_ranks(request_with_session(99)) == []


def test_mission_6_returns_one_mentor_from_global_ranking(monkeypatch):
    monkeypatch.setattr(
        ranks,
        "rank_data",
        lambda: [
            {"id": 2, "name": "Second", "matched_count": 1},
            {"id": 1, "name": "First", "matched_count": 2},
        ],
    )

    assert ranks.get_mentor_rank(2, request_with_session(99)) == {
        "mentorId": 2,
        "mentorName": "Second",
        "matchedCount": 1,
        "rank": 2,
        "badge": "Platinum",
    }


def test_mission_6_returns_zero_match_mentor_with_null_rank_and_badge(monkeypatch):
    monkeypatch.setattr(
        ranks,
        "rank_data",
        lambda: [
            {"id": 1, "name": "Active", "matched_count": 2},
            {"id": 2, "name": "Waiting", "matched_count": 0},
        ],
    )

    assert ranks.get_mentor_rank(2, request_with_session(99)) == {
        "mentorId": 2,
        "mentorName": "Waiting",
        "matchedCount": 0,
        "rank": None,
        "badge": None,
    }


@pytest.mark.parametrize(("mentor_id", "status"), [(0, 422), (-1, 422), (404, 404)])
def test_mission_6_rejects_invalid_or_missing_mentor(monkeypatch, mentor_id, status):
    monkeypatch.setattr(ranks, "rank_data", lambda: [])

    with pytest.raises(HTTPException) as exc:
        ranks.get_mentor_rank(mentor_id, request_with_session(99))

    assert exc.value.status_code == status


def test_mission_6_authenticates_before_id_validation_or_query(monkeypatch):
    monkeypatch.setattr(ranks, "rank_data", lambda: pytest.fail("query must not run"))

    with pytest.raises(HTTPException) as exc:
        ranks.get_mentor_rank(0, request_with_session())

    assert exc.value.status_code == 401


@pytest.mark.skipif(not os.environ.get("MENTOR_RANKS_TEST_DSN"), reason="set MENTOR_RANKS_TEST_DSN for PostgreSQL test")
def test_mission_1_aggregates_real_postgresql_without_persistent_changes(monkeypatch):
    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect(
        os.environ["MENTOR_RANKS_TEST_DSN"], cursor_factory=psycopg2.extras.RealDictCursor
    )
    try:
        with conn.cursor() as cur:
            cur.execute("CREATE TEMP TABLE users (id integer PRIMARY KEY, name text NOT NULL, role text NOT NULL)")
            cur.execute(
                "CREATE TEMP TABLE requests (id integer PRIMARY KEY, author_id integer NOT NULL, role text NOT NULL, status text NOT NULL, matched_user_id integer)"
            )
            cur.executemany(
                "INSERT INTO users (id, name, role) VALUES (%s, %s, %s)",
                [
                    (1, "Author Mentor", "mentor"),
                    (2, "Matched Mentor", "mentor"),
                    (3, "Both Mentor", "both"),
                    (4, "Mentee", "mentee"),
                    (5, "Zero Mentor", "mentor"),
                    (6, "Zero Both", "both"),
                ],
            )
            cur.executemany(
                "INSERT INTO requests (id, author_id, role, status, matched_user_id) VALUES (%s, %s, %s, %s, %s)",
                [
                    (101, 1, "mentor", "matched", 4),
                    (102, 4, "mentee", "matched", 2),
                    (103, 3, "mentor", "matched", 4),
                    (104, 4, "mentee", "matched", 3),
                    (105, 1, "mentor", "open", 4),
                    (106, 1, "mentor", "matched", None),
                    (107, 4, "mentee", "matched", 4),
                    (108, 1, "mentor", "closed", 4),
                ],
            )

        @contextmanager
        def test_db():
            yield conn

        monkeypatch.setattr(ranks, "db", test_db)

        assert ranks.rank_data() == [
            {"id": 1, "name": "Author Mentor", "matched_count": 1},
            {"id": 2, "name": "Matched Mentor", "matched_count": 1},
            {"id": 3, "name": "Both Mentor", "matched_count": 2},
            {"id": 5, "name": "Zero Mentor", "matched_count": 0},
            {"id": 6, "name": "Zero Both", "matched_count": 0},
        ]
    finally:
        conn.rollback()
        conn.close()


def test_lesson_app_registers_auth_and_defaults_to_student_routes(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://tests@localhost/tests")
    monkeypatch.setenv("SESSION_SECRET", "test-secret")
    import mentor_ranks_server

    app = mentor_ranks_server.create_app()
    routes = {route.path: route.endpoint for route in app.routes}

    assert "/api/auth/login" in routes
    assert routes["/api/mentor-ranks"].__module__ == "mentor_ranks"
    assert routes["/api/mentor-ranks/{mentor_id}"].__module__ == "mentor_ranks"


def test_lesson_app_answer_flag_explicitly_selects_reference(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://tests@localhost/tests")
    monkeypatch.setenv("SESSION_SECRET", "test-secret")
    import mentor_ranks_server

    app = mentor_ranks_server.create_app(answer=True)
    routes = {route.path: route.endpoint for route in app.routes}

    assert routes["/api/mentor-ranks"].__module__ == "mentor_ranks_answer"
    assert routes["/api/mentor-ranks/{mentor_id}"].__module__ == "mentor_ranks_answer"


def test_lesson_http_list_and_detail_share_global_ranks(backend_database, backend_server):
    import psycopg2

    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO requests (author_id, district_id, title, description, role, status, matched_user_id) "
            "VALUES (%s, 1, 'Ranking fixture', 'Help', %s, 'matched', %s)",
            [(501, "mentor", 1), (501, "mentor", 2), (1, "mentee", 501),
             (951, "mentor", 1), (2, "mentee", 951)],
        )
        conn.commit()

    expected = [
        {"mentorId": 501, "mentorName": "Sophia Lee", "matchedCount": 3, "rank": 1, "badge": "Master"},
        {"mentorId": 951, "mentorName": "Jordan Park", "matchedCount": 2, "rank": 2, "badge": "Platinum"},
        {"mentorId": 502, "mentorName": "Marcus Chen", "matchedCount": 0, "rank": None, "badge": None},
    ]
    with backend_server("mentor_ranks_server:create_app", factory=True) as base:
        anonymous = build_opener()
        for path in ("/api/mentor-ranks", "/api/mentor-ranks/0"):
            assert api(anonymous, base, "GET", path)[0] == 401

        client, _ = login(base, "student001@test.edu")
        status, rows = api(client, base, "GET", "/api/mentor-ranks")
        assert status == 200
        assert rows == expected
        for row in expected:
            status, detail = api(client, base, "GET", f"/api/mentor-ranks/{row['mentorId']}")
            assert status == 200
            assert detail == row

        for mentor_id, expected_status in ((0, 422), (-1, 422), (1, 404), (999999, 404)):
            assert api(client, base, "GET", f"/api/mentor-ranks/{mentor_id}")[0] == expected_status
