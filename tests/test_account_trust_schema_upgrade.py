"""0005 -> 0006 resets suffix-based trust and preserves every content row."""
from contextlib import closing
from pathlib import Path
import psycopg2
from backend_support import api,login

ROOT=Path(__file__).resolve().parents[1]


def test_0005_upgrade_preserves_content_resets_legacy_trust_and_never_promotes_admin(backend_database,backend_server):
    with closing(psycopg2.connect(backend_database)) as conn,conn.cursor() as cur:
        cur.execute('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
        for migration in sorted((ROOT/'database/migrations').glob('000[1-5]_*.sql')):
            cur.execute(migration.read_text())
        cur.execute((ROOT/'tests/fixtures/chat-canonical.sql').read_text())
        cur.execute("INSERT INTO requests(author_id,district_id,title,description,role) VALUES (1,1,'Keep','content','mentee') RETURNING id")
        req=cur.fetchone()[0]
        cur.execute("INSERT INTO request_comments(request_id,author_id,body,client_comment_id) VALUES (%s,501,'keep comment','11111111-1111-4111-8111-111111111111')",(req,))
        cur.execute("INSERT INTO reports(reporter_id,reported_user_id,reason,description) VALUES (1,501,'other','keep report')")
        tables=['chat_messages','dm_messages','requests','request_comments','reports','blocks']
        before={}
        for table in tables:
            cur.execute('SELECT * FROM '+table+' ORDER BY id')
            before[table]=cur.fetchall()
        cur.execute((ROOT/'database/migrations/0006_account_trust.sql').read_text())
        for table in tables:
            # Compare the complete pre-existing projection, including existing IDs and timestamps.
            cur.execute('SELECT * FROM '+table+' ORDER BY id')
            after=cur.fetchall()
            assert [row[:len(before[table][0])] for row in after]==before[table]
        cur.execute('SELECT is_verified,email_verified_at,is_admin FROM users')
        assert all(row==(False,None,False) for row in cur.fetchall())
        # Current application expects the later additive columns; the trust
        # transition assertions above remain pinned to the 0006 boundary.
        for migration in sorted((ROOT/'database/migrations').glob('000[7-9]_*.sql')):
            cur.execute(migration.read_text())
        conn.commit()
    with backend_server() as base:
        client,_=login(base,'student001@test.edu')
        assert api(client,base,'GET','/api/auth/me')[1]['isVerified'] is False
        assert api(client,base,'GET','/api/requests')[0]==200
        assert api(client,base,'GET','/api/admin/reports')[0]==403
