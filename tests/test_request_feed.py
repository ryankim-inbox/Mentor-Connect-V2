"""Bounded request writes and stable list windows over real HTTP/PostgreSQL."""
from contextlib import closing
from urllib.parse import urlencode

import psycopg2
import pytest

from backend_support import api, login


def test_request_utf8_limits(backend_server):
    with backend_server() as base:
        client, _ = login(base, "student001@test.edu")
        body = {"districtId": 1, "title": " é ", "description": " Detail ", "role": "mentee"}
        status, created = api(client, base, "POST", "/api/requests", body)
        assert status == 201
        path = f'/api/requests/{created["id"]}'
        for field, valid, invalid in [
            ("title", "é" * 100, "é" * 100 + "a"),
            ("description", "🦉" * 1000, "🦉" * 1000 + "a"),
        ]:
            for value, expected in [(valid, 201), (invalid, 422), (" \t\n", 422),
                                    (" " + valid, 422)]:
                assert api(client, base, "POST", "/api/requests", {**body, field: value})[0] == expected
                assert api(client, base, "PATCH", path, {field: value})[0] == (200 if expected == 201 else expected)
        status, trimmed = api(client, base, "POST", "/api/requests", body)
        assert status == 201 and trimmed["title"] == "é" and trimmed["description"] == "Detail"
        assert trimmed["descriptionTruncated"] is False
        assert api(client, base, "GET", path)[1]["descriptionTruncated"] is False


def test_legacy_large_feed_survives_gateway(backend_database, gateway_server):
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO requests (author_id, district_id, title, description, role) VALUES (1, 1, %s, %s, 'mentee')",
            [("a" + "🦉" * 99, "a" + char * 749999) for char in ["a", "é", "🦉"]],
        )
        conn.commit()
    client, _ = login(gateway_server, "student001@test.edu")
    status, rows = api(client, gateway_server, "GET", "/api/requests")
    assert status == 200, rows
    assert len(rows) == 3
    assert all(len(row["description"].encode()) <= 4000 and len(row["title"].encode()) <= 200 for row in rows)
    assert all(row["descriptionTruncated"] is True for row in rows)
    assert all(row["title"] == "a" + "🦉" * 49 for row in rows)
    assert {len(row["description"].encode()) for row in rows} == {3997, 3999, 4000}
    ascii_id = next(row["id"] for row in rows if row["description"] == "a" * 4000)
    status, detail = api(client, gateway_server, "GET", f"/api/requests/{ascii_id}")
    assert status == 200 and len(detail["description"]) == 750000
    assert detail["descriptionTruncated"] is False
    unicode_id = next(row["id"] for row in rows if "🦉" in row["description"])
    assert api(client, gateway_server, "GET", f"/api/requests/{unicode_id}")[0] == 502
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("SELECT length(description), length(title) FROM requests")
        assert cur.fetchall() == [(750000, 100)] * 3


def test_cursor_filters_before_limit(backend_database, backend_server):
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO requests (id, author_id, district_id, title, description, role, created_at)
            SELECT n, 1, 1, 'Page ' || n, 'Detail', 'mentee', '2026-10-01 12:00:00+00'
            FROM generate_series(1, 120) n""")
        cur.execute("INSERT INTO request_tags (request_id, tag_id) SELECT n, 1 FROM generate_series(1, 20) n")
        cur.execute("""INSERT INTO requests (id, author_id, district_id, title, description, role, status)
            VALUES (121, 1, 2, 'Other district', 'Detail', 'mentee', 'open'),
                   (122, 1, 1, 'Other role', 'Detail', 'mentor', 'open'),
                   (123, 1, 1, 'Closed', 'Detail', 'mentee', 'closed')""")
        conn.commit()
    def ids(rows):
        return [row["id"] for row in rows]
    def row_has_requested_tag(row):
        return any(tag["id"] == 1 for tag in row["tags"])
    with backend_server() as base:
        client, _ = login(base, "student001@test.edu")
        filters = {"districtId": 1, "role": "mentee", "status": "open"}
        status, page1 = api(client, base, "GET", "/api/requests?" + urlencode(filters))
        assert status == 200
        assert len(page1) == 50
        cursor = f'{page1[-1]["createdAt"]}|{page1[-1]["id"]}'
        with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
            cur.execute("INSERT INTO requests (id, author_id, district_id, title, description, role) VALUES (124, 1, 1, 'New', 'Detail', 'mentee')")
            conn.commit()
        status, page2 = api(client, base, "GET", "/api/requests?" + urlencode({**filters, "before": cursor}))
        assert status == 200
        expected_first_100_before_new_insert = list(range(120, 20, -1))
        assert set(ids(page1)).isdisjoint(ids(page2))
        assert ids(page1 + page2) == expected_first_100_before_new_insert
        status, tagged_page = api(client, base, "GET", "/api/requests?" + urlencode({**filters, "tagId": 1, "limit": 5}))
        assert status == 200 and ids(tagged_page) == [20, 19, 18, 17, 16]
        assert all(row_has_requested_tag(row) for row in tagged_page)
        status, final = api(client, base, "GET", "/api/requests?" + urlencode({**filters, "before": f'{page2[-1]["createdAt"]}|{page2[-1]["id"]}'}))
        assert status == 200 and ids(final) == list(range(20, 0, -1))


@pytest.mark.parametrize("query", [
    "limit=0", "limit=51", "before=garbage", "before=2026-10-01T12:00:00%7C1",
    "before=2026-10-01T12:00:00Z%7C0", "before=2026-10-01T12:00:00Z%7C01",
    "before=2026-02-30T12:00:00Z%7C1", "before=" + "x" * 97,
])
def test_request_invalid_paging_is_422(backend_server, query):
    with backend_server() as base:
        client, _ = login(base, "student001@test.edu")
        assert api(client, base, "GET", "/api/requests?" + query)[0] == 422
