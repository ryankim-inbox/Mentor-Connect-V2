from contextlib import closing
from urllib.request import build_opener

import psycopg2

from backend_support import api


def test_district_type_and_search_intersection(chat_server, chat_database):
    with closing(psycopg2.connect(chat_database)) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO districts (name, county, type) VALUES (%s, %s, %s) RETURNING id",
            ("Fremont Unified School District", "Santa Clara", "unified"),
        )
        unified_id = cur.fetchone()[0]
        conn.commit()

    with chat_server() as base:
        client = build_opener()

        status, unified = api(client, base, "GET", "/api/districts?type=unified")
        assert status == 200
        assert {row["id"] for row in unified} == {unified_id}
        assert all(row["type"] == "unified" for row in unified)

        status, high_school = api(client, base, "GET", "/api/districts?type=high_school")
        assert status == 200
        assert {row["id"] for row in high_school} == {1, 2}
        assert all(row["type"] == "high_school" for row in high_school)

        status, matching_high_school = api(
            client, base, "GET", "/api/districts?type=high_school&search=Fremont"
        )
        assert status == 200
        assert {row["id"] for row in matching_high_school} == {1}

        status, all_districts = api(client, base, "GET", "/api/districts")
        assert status == 200
        assert {row["id"] for row in all_districts} == {1, 2, unified_id}

        status, unmatched = api(
            client, base, "GET", "/api/districts?search=zzzz_no_such_district"
        )
        assert status == 200
        assert unmatched == []


def test_district_rejects_unsupported_type(chat_server):
    with chat_server() as base:
        status, _ = api(build_opener(), base, "GET", "/api/districts?type=elementary")

    assert status == 422
