from contextlib import closing

import psycopg2

from backend_support import api, login


def test_profile_bio_null_empty_and_omitted(gateway_server, backend_server, backend_database):
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("UPDATE users SET bio = %s WHERE id = %s", ("Initial bio", 1))
        conn.commit()

    base = gateway_server
    student, _ = login(base, "student001@test.edu")
    mentor, _ = login(base, "mentor501@test.edu")

    status, user = api(student, base, "PATCH", "/api/users/1", {"bio": None})
    assert status == 200, user
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("SELECT bio FROM users WHERE id = %s", (1,))
        assert cur.fetchone()[0] is None

    status, user = api(student, base, "PATCH", "/api/users/1", {"bio": ""})
    assert status == 200
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("SELECT bio FROM users WHERE id = %s", (1,))
        assert cur.fetchone()[0] == ""

    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("UPDATE users SET bio = %s WHERE id = %s", ("Keep this", 1))
        conn.commit()
    status, user = api(student, base, "PATCH", "/api/users/1", {"name": "Alex Kim"})
    assert status == 200
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("SELECT bio FROM users WHERE id = %s", (1,))
        assert cur.fetchone()[0] == "Keep this"

    status, user = api(student, base, "PATCH", "/api/users/1",
                       {"name": "Alex Updated", "bio": None})
    assert status == 200 and user["name"] == "Alex Updated"
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("SELECT bio FROM users WHERE id = %s", (1,))
        assert cur.fetchone()[0] is None

    status, _ = api(mentor, base, "PATCH", "/api/users/1", {"bio": "Forbidden"})
    assert status == 404
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute("SELECT bio FROM users WHERE id = %s", (1,))
        assert cur.fetchone()[0] is None

    with backend_server() as backend_base:
        backend_mentor, _ = login(backend_base, "mentor501@test.edu")
        status, _ = api(backend_mentor, backend_base, "PATCH", "/api/users/1",
                        {"bio": "Forbidden"})
        assert status == 403
        with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
            cur.execute("SELECT bio FROM users WHERE id = %s", (1,))
            assert cur.fetchone()[0] is None
