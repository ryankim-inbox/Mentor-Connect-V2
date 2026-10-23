"""Additive upgrade preserves pre-consent data and works with narrow app grants."""
from contextlib import closing
from pathlib import Path
from uuid import uuid4
import getpass
import os
import subprocess
from http.cookiejar import CookieJar
from urllib.request import build_opener, HTTPCookieProcessor
from urllib.parse import quote

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import make_dsn, parse_dsn

from backend_support import api, login
from test_account_trust import token_from

ROOT = Path(__file__).resolve().parents[1]


def test_upgrade_from_0003_preserves_data_and_new_flows_use_narrow_grants(backend_database, backend_server, tmp_path):
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
        for migration in sorted((ROOT / 'database/migrations').glob('000[7-9]_*.sql')):
            cur.execute(migration.read_text())
        cur.execute('UPDATE users SET email_verified_at=now(),is_verified=true')
        cur.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
        cur.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(role)))
        grants = [
            ('SELECT', 'districts,tags,questions,chat_rooms'),
            ('SELECT,INSERT,UPDATE', 'users,dm_messages,request_applications,request_comments,reports'),
            ('SELECT,INSERT,UPDATE,DELETE', 'requests'),
            ('SELECT,INSERT,DELETE', 'request_tags,blocks'),
            ('SELECT,INSERT', 'chat_messages,dm_conversations,request_events'),
            ('SELECT,INSERT', 'request_submission_keys,notifications'),
            ('UPDATE(read_at)', 'notifications'),
            ('SELECT,INSERT,DELETE', 'email_verification_tokens,email_verification_requests'),
        ]
        for privileges, tables in grants:
            cur.execute(sql.SQL('GRANT '+privileges+' ON '+tables+' TO {}').format(sql.Identifier(role)))
        cur.execute(sql.SQL('GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO {}').format(sql.Identifier(role)))
        conn.commit()
    try:
        target=parse_dsn(backend_database)
        owner_url=f"postgresql://{quote(target.get('user',getpass.getuser()),safe='')}@{target['host']}:{target['port']}/{target['dbname']}"
        subprocess.run(['node','tests/support/apply-account-trust-grants.mjs'],cwd=ROOT,check=True,
                       env={**os.environ,'TEST_APP_ROLE_DATABASE_URL':owner_url,'TEST_APP_ROLE':role},capture_output=True)
        with closing(psycopg2.connect(make_dsn(backend_database,user=role))) as app,app.cursor() as cur:
            cur.execute("SELECT has_column_privilege(current_user,'users','is_admin','INSERT'),has_column_privilege(current_user,'users','is_admin','UPDATE')")
            assert cur.fetchone()==(False,False)
        # Proposed release grant is exercised only on this disposable synthetic role.
        with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
            cur.execute(sql.SQL('GRANT INSERT(gender,date_of_birth) ON users TO {}').format(sql.Identifier(role)))
            conn.commit()
        environment={'EMAIL_DELIVERY_MODE':'development-file','EMAIL_DEV_OUTBOX_DIR':str(tmp_path/'outbox'),'APP_ORIGIN':'http://localhost:5173'}
        with backend_server(database_url=make_dsn(backend_database, user=role),environment=environment) as base:
            new_user=build_opener(HTTPCookieProcessor(CookieJar()))
            status,registration=api(new_user,base,'POST','/api/auth/register',{'email':'grant-owner@test.edu','name':'Grant owner','password':'Password123!','role':'mentee','districtId':1,'gender':'female','dateOfBirth':'2008-02-29'})
            assert status==201,registration
            assert registration['user']['isAdmin'] is False and registration['user']['isVerified'] is False
            assert api(new_user,base,'PATCH',f"/api/users/{registration['user']['id']}",{'name':'Changed','bio':'local only','role':'both','subjects':['Math']})[0]==200
            assert api(new_user,base,'POST','/api/auth/verification/request')[0]==202
            status,verified=api(new_user,base,'POST','/api/auth/verification/confirm',{'token':token_from(tmp_path/'outbox')})
            assert status==200 and verified['isVerified'] is True and verified['isAdmin'] is False
            assert api(new_user,base,'GET','/api/analytics/weekly-matches')[0]==403
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
