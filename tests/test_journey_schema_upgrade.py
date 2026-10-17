"""Additive upgrade preserves pre-consent data and works with narrow app grants."""
from contextlib import closing
from pathlib import Path
from uuid import uuid4

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import make_dsn

from backend_support import api, login

ROOT = Path(__file__).resolve().parents[1]


def test_upgrade_from_0003_preserves_data_and_new_flows_use_narrow_grants(backend_database, backend_server):
    role = 'journey_app_' + uuid4().hex
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        # This database is created solely for this test; no shared DB is touched.
        cur.execute('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
        for migration in sorted((ROOT / 'database/migrations').glob('000[1-3]_*.sql')):
            cur.execute(migration.read_text())
        cur.execute((ROOT / 'tests/fixtures/chat-canonical.sql').read_text())
        cur.execute("INSERT INTO requests(author_id,district_id,title,description,role,status,matched_user_id) VALUES (1,1,'Legacy match','keep','mentee','matched',501) RETURNING id")
        legacy_id = cur.fetchone()[0]
        cur.execute('SELECT id,body FROM chat_messages ORDER BY id')
        messages = cur.fetchall()
        for migration in sorted((ROOT / 'database/migrations').glob('000[4-5]_*.sql')):
            cur.execute(migration.read_text())
        cur.execute('SELECT id,body FROM chat_messages ORDER BY id')
        assert cur.fetchall() == messages
        cur.execute('SELECT count(*) FROM request_applications')
        assert cur.fetchone()[0] == 0
        cur.execute((ROOT / 'database/migrations/0006_account_trust.sql').read_text())
        cur.execute('SELECT count(*) FROM users WHERE is_verified OR email_verified_at IS NOT NULL')
        assert cur.fetchone()[0] == 0
        cur.execute('UPDATE users SET email_verified_at=now(),is_verified=true')
        cur.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
        cur.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(role)))
        grants = [
            ('SELECT', 'districts,tags,questions,chat_rooms'),
            ('SELECT,INSERT,UPDATE', 'users,dm_messages,request_applications,request_comments,reports'),
            ('SELECT,INSERT,UPDATE,DELETE', 'requests'),
            ('SELECT,INSERT,DELETE', 'request_tags,blocks'),
            ('SELECT,INSERT', 'chat_messages,dm_conversations,request_events'),
        ]
        for privileges, tables in grants:
            cur.execute(sql.SQL('GRANT '+privileges+' ON '+tables+' TO {}').format(sql.Identifier(role)))
        cur.execute(sql.SQL('GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO {}').format(sql.Identifier(role)))
        conn.commit()
    try:
        with backend_server(database_url=make_dsn(backend_database, user=role)) as base:
            owner, _ = login(base, 'student001@test.edu')
            mentor, _ = login(base, 'mentor501@test.edu')
            assert any(c['requestId'] == legacy_id for c in api(owner, base, 'GET', '/api/connections')[1])
            status, request = api(owner, base, 'POST', '/api/requests', {'districtId':1,'title':'New consent','description':'local only','role':'mentee'})
            assert status == 201
            path = f'/api/requests/{request["id"]}'
            app = api(mentor, base, 'POST', path+'/applications')[1]
            assert app['status'] == 'pending'
            assert api(owner, base, 'PATCH', path+f'/applications/{app["id"]}', {'action':'accept'})[0] == 200
            assert api(mentor, base, 'POST', path+'/comments', {'body':'comment','clientCommentId':str(uuid4())})[0] == 201
            body={'body':'retry','clientMessageId':str(uuid4())}
            first=api(owner,base,'POST','/api/chat/rooms/1/messages',body)
            assert first[0] == 201
            assert api(owner,base,'POST','/api/chat/rooms/1/messages',body)[1]['id'] == first[1]['id']
    finally:
        with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
            cur.execute(sql.SQL('DROP OWNED BY {}').format(sql.Identifier(role)))
            cur.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))
            conn.commit()
