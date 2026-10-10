from contextlib import closing
from urllib.request import build_opener

import psycopg2

from backend_support import api


def test_district_top_tags_exclude_other_districts(chat_server, chat_database):
    with closing(psycopg2.connect(chat_database)) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO tags (name, color) VALUES ('Chemistry', '#f00'), ('Algebra', '#0f0') RETURNING id, name")
        tag_ids = {name: tag_id for tag_id, name in cur.fetchall()}
        for title in ("Math request 1", "Math request 2"):
            cur.execute(
                "INSERT INTO requests (author_id, district_id, title, description, role) VALUES (1, 1, %s, 'Help', 'mentee') RETURNING id",
                (title,),
            )
            cur.execute("INSERT INTO request_tags (request_id, tag_id) VALUES (%s, 1)", (cur.fetchone()[0],))
        conn.commit()

    with chat_server() as base:
        client = build_opener()

        status, empty_district = api(client, base, "GET", "/api/stats/district/2")
        assert status == 200
        assert empty_district["topTags"] == []

        with closing(psycopg2.connect(chat_database)) as conn, conn.cursor() as cur:
            for tag_id, title in ((tag_ids["Chemistry"], "Chemistry request"), (tag_ids["Algebra"], "Algebra request")):
                cur.execute(
                    "INSERT INTO requests (author_id, district_id, title, description, role) VALUES (2, 2, %s, 'Help', 'mentee') RETURNING id",
                    (title,),
                )
                cur.execute("INSERT INTO request_tags (request_id, tag_id) VALUES (%s, %s)", (cur.fetchone()[0], tag_id))
            conn.commit()

        status, district_a = api(client, base, "GET", "/api/stats/district/1")
        assert status == 200
        assert district_a["topTags"] == [
            {"id": 1, "name": "Math", "color": "#3b82f6", "requestCount": 2}
        ]

        status, district_b = api(client, base, "GET", "/api/stats/district/2")
        assert status == 200
        assert district_b["topTags"] == [
            {"id": tag_ids["Chemistry"], "name": "Chemistry", "color": "#f00", "requestCount": 1},
            {"id": tag_ids["Algebra"], "name": "Algebra", "color": "#0f0", "requestCount": 1},
        ]

        status, overview = api(client, base, "GET", "/api/stats/overview")
        assert status == 200
        assert overview["topTags"] == [
            {"id": 1, "name": "Math", "color": "#3b82f6", "requestCount": 2},
            {"id": tag_ids["Chemistry"], "name": "Chemistry", "color": "#f00", "requestCount": 1},
            {"id": tag_ids["Algebra"], "name": "Algebra", "color": "#0f0", "requestCount": 1},
        ]
