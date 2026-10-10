"""Weekly availability counts and suggestions use real configured data."""
from contextlib import closing

import psycopg2
import pytest

import db
import scheduling
from backend_support import api, login


@pytest.fixture
def scheduling_db(backend_database, monkeypatch):
    monkeypatch.setattr(db, "DATABASE_URL", backend_database)
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("UPDATE users SET available_times = NULL")
        cur.execute("UPDATE users SET available_times = %s WHERE id = 1",
                    (["Mon 17:00", "Mon 17:00", "Wed 19:00", "Mon 25:00"],))
        cur.execute("UPDATE users SET available_times = %s WHERE id = 501",
                    (["Wed 19:00", "Mon 17:00", "Mon 25:00"],))
        conn.commit()
    return backend_database


def test_scheduling_overlap_and_counts(scheduling_db):
    assert scheduling.time_dict(
        {"available_times": ["Mon 17:00", "Mon 17:00", "Wed 19:00", "Mon 25:00"]},
        {"available_times": ["Wed 19:00", "Mon 17:00", "Mon 25:00"]},
    ) == ["Mon 17:00", "Wed 19:00"]
    assert scheduling.receive_time_data() == [
        {"slot": "Mon 17:00", "count": 2}, {"slot": "Wed 19:00", "count": 2},
    ]
    with closing(psycopg2.connect(scheduling_db)) as conn, conn.cursor() as cur:
        cur.execute("UPDATE users SET available_times = NULL")
        conn.commit()
    assert scheduling.receive_time_data() == []


@pytest.mark.parametrize("student,teacher,expected", [
    ({}, {}, []),
    ({"available_times": None}, {"available_times": ["Mon 17:00"]}, []),
    ({"available_times": ["Mon 17:00"]}, {"available_times": None}, []),
    ({"available_times": []}, {}, []),
    ({"available_times": ["Mon 17:00"]}, {"available_times": ["Wed 19:00"]}, []),
    ({"available_times": ["Mon 25:00", "Mon 17:30", "Mon 17:00\n", "mon 17:00", None, 3]},
     {"available_times": ["Mon 25:00", "Mon 17:30", "Mon 17:00\n", "mon 17:00", None, 3]}, []),
    ({"available_times": ["Sun 23:00", "Fri 12:00", "Mon 23:00", "Tue 00:00", "Mon 00:00", "Sat 10:00", "Thu 10:00", "Wed 10:00"]},
     {"available_times": ["Sun 23:00", "Fri 12:00", "Mon 23:00", "Tue 00:00", "Mon 00:00", "Sat 10:00", "Thu 10:00", "Wed 10:00"]},
     ["Mon 00:00", "Mon 23:00", "Tue 00:00", "Wed 10:00", "Thu 10:00", "Fri 12:00", "Sat 10:00", "Sun 23:00"]),
])
def test_scheduling_pure_overlap(student, teacher, expected):
    assert scheduling.time_dict(student, teacher) == expected


def test_scheduling_counts_order_by_weekday_and_hour(scheduling_db):
    with closing(psycopg2.connect(scheduling_db)) as conn, conn.cursor() as cur:
        cur.execute("UPDATE users SET available_times = %s WHERE id = 502",
                    (["Sun 23:00", "Tue 00:00", "Mon 00:00", "Mon 00:00", "Mon 25:00"],))
        conn.commit()
    assert scheduling.receive_time_data() == [
        {"slot": "Mon 00:00", "count": 1}, {"slot": "Mon 17:00", "count": 2},
        {"slot": "Tue 00:00", "count": 1}, {"slot": "Wed 19:00", "count": 2},
        {"slot": "Sun 23:00", "count": 1},
    ]


def test_real_gateway_scheduling_and_popular_slots(scheduling_db, gateway_server):
    client, _ = login(gateway_server, "student001@test.edu")
    slots = [{"slot": "Mon 17:00", "count": 2}, {"slot": "Wed 19:00", "count": 2}]
    for path, expected in [("/api/scheduling/overview", {"topSlots": slots}),
                           ("/api/analytics/popular-time-slots", slots)]:
        status, result = api(client, gateway_server, "GET", path)
        assert status == 200 and result["success"] and result["source"] == "python", result
        assert result["data"] == expected
    status, result = api(client, gateway_server, "GET", "/api/scheduling/suggest?user_a=1&user_b=501")
    assert status == 200 and result["success"], result
    assert result["data"]["overlap"] == ["Mon 17:00", "Wed 19:00"]
    assert result["data"]["userA"]["id"] == 1
    assert result["data"]["userB"]["id"] == 501
    assert set(result["data"]) == {"userA", "userB", "overlap"}
    status, result = api(client, gateway_server, "GET", "/api/scheduling/suggest?user_a=1&user_b=502")
    assert status == 200 and result["success"] and result["data"]["overlap"] == [], result
    for user_a, user_b in [(99999, 501), (1, 99999)]:
        assert api(client, gateway_server, "GET",
                   f"/api/scheduling/suggest?user_a={user_a}&user_b={user_b}")[0] == 404
