"""The additive 0008 migration preserves content and supports atomic rollback."""
from contextlib import closing
from pathlib import Path

import psycopg2
import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_student_demo_upgrade_preserves_rows_and_context_after_post_deletion(backend_database):
    migration = ROOT / 'database/migrations/0008_student_demo.sql'
    assert migration.exists(), 'student demo needs an explicit additive migration'
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
        for path in sorted((ROOT / 'database/migrations').glob('000[1-7]_*.sql')):
            cur.execute(path.read_text())
        cur.execute((ROOT / 'tests/fixtures/chat-canonical.sql').read_text())
        cur.execute("INSERT INTO requests(author_id,district_id,title,description,role) VALUES (501,1,'Keep title','Keep content','mentor') RETURNING id")
        request_id = cur.fetchone()[0]
        cur.execute("INSERT INTO reports(reporter_id,reported_user_id,reason,description) VALUES (1,501,'other','Keep evidence') RETURNING id")
        report_id = cur.fetchone()[0]
        before = {}
        for table in ('users', 'requests', 'reports', 'chat_messages', 'dm_messages'):
            cur.execute('SELECT * FROM ' + table + ' ORDER BY id')
            before[table] = cur.fetchall()
        conn.commit()

        cur.execute(migration.read_text())
        conn.rollback()
        cur.execute("SELECT count(*) FROM information_schema.columns WHERE table_name='requests' AND column_name='client_request_id'")
        assert cur.fetchone()[0] == 0
        cur.execute(migration.read_text())
        conn.commit()
        for table, rows in before.items():
            cur.execute('SELECT * FROM ' + table + ' ORDER BY id')
            assert [row[:len(rows[0])] for row in cur.fetchall()] == rows
        cur.execute('SELECT target_type,request_id,request_title FROM reports WHERE id=%s', (report_id,))
        assert cur.fetchone() == ('profile', None, None)
        cur.execute("INSERT INTO reports(reporter_id,reported_user_id,reason,target_type,request_id,request_title) VALUES(1,501,'spam','request',%s,'Keep title') RETURNING id", (request_id,))
        contextual_id = cur.fetchone()[0]
        cur.execute('DELETE FROM requests WHERE id=%s', (request_id,))
        cur.execute('SELECT request_id,request_title FROM reports WHERE id=%s', (contextual_id,))
        assert cur.fetchone() == (None, 'Keep title')
        conn.commit()


def test_student_demo_constraints_reject_invalid_identity_and_context(backend_database):
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        for statement in (
            "INSERT INTO requests(author_id,district_id,title,description,role,payload_hash) VALUES(1,1,'x','x','mentee','bad')",
            "INSERT INTO reports(reporter_id,reported_user_id,reason,target_type) VALUES(1,501,'spam','invented')",
            "INSERT INTO reports(reporter_id,reported_user_id,reason,target_type,request_title) VALUES(1,501,'spam','profile','spoofed')",
        ):
            with pytest.raises(psycopg2.errors.CheckViolation):
                cur.execute(statement)
            conn.rollback()
