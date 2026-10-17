"""Ownership is proved by persisted one-use tokens, never by a school suffix."""
from contextlib import closing
import hashlib
import json
from pathlib import Path
from urllib.request import build_opener
from urllib.parse import urlsplit, parse_qs

import psycopg2
import pytest
from backend_support import api, login


def execute(dsn, query, params=()):
    with closing(psycopg2.connect(dsn)) as conn, conn.cursor() as cur:
        cur.execute(query, params)
        result = cur.fetchall() if cur.description else None
        conn.commit()
        return result


def unverify(dsn, user=1):
    # The introspection lets the pre-implementation run reach HTTP assertions.
    if execute(dsn, "SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='email_verified_at'"):
        execute(dsn, 'UPDATE users SET email_verified_at=NULL,is_verified=false WHERE id=%s', (user,))


def token_from(outbox):
    item = json.loads(sorted(Path(outbox).glob('*.json'), key=lambda p:p.stat().st_mtime_ns)[-1].read_text())
    return parse_qs(urlsplit(item['confirmationUrl']).fragment)['token'][0]


def test_registration_cannot_prove_ownership_or_grant_privilege(backend_server):
    with backend_server() as base:
        client = build_opener()
        body = {'email':'new@test.edu','name':'New','password':'Password123!','role':'both','districtId':1}
        status, payload = api(client,base,'POST','/api/auth/register',body)
        assert status == 201
        assert payload['user']['isVerified'] is False
        assert payload['user']['isAdmin'] is False
        for field in ('isAdmin','isVerified','email_verified_at','user_id'):
            assert api(client,base,'POST','/api/auth/register',{**body,'email':field+'@test.edu',field:True})[0] == 422


def test_unverified_denied_members_and_operations_but_can_manage_self(backend_database, backend_server):
    unverify(backend_database)
    with backend_server() as base:
        client,_ = login(base,'student001@test.edu')
        assert api(client,base,'GET','/api/auth/me')[0] == 200
        assert api(client,base,'GET','/api/users/1')[0] == 200
        assert api(client,base,'PATCH','/api/users/1',{'bio':'Own settings'})[0] == 200
        for path in ('/api/users/501','/api/requests','/api/mentors','/api/chat/rooms','/api/blocks','/api/analytics/weekly-matches'):
            assert api(client,base,'GET',path)[0] == 403, path
        for field in ('isAdmin','isVerified','email','districtId'):
            assert api(client,base,'PATCH','/api/users/1',{field:True})[0] == 422
        assert api(client,base,'PATCH','/api/users/1',{'role':'admin'})[0] == 422


def test_ownership_request_confirm_replay_and_secret_storage(backend_database, backend_server, monkeypatch,tmp_path):
    unverify(backend_database)
    monkeypatch.setenv('EMAIL_DELIVERY_MODE','development-file')
    monkeypatch.setenv('EMAIL_DEV_OUTBOX_DIR',str(tmp_path/'outbox'))
    monkeypatch.setenv('APP_ORIGIN','http://localhost:5173')
    with backend_server() as base:
        client,_=login(base,'student001@test.edu')
        assert api(client,base,'POST','/api/auth/verification/request',{'role':'admin'})[0] == 422
        status,payload=api(client,base,'POST','/api/auth/verification/request')
        assert status == 202, payload
        token=token_from(tmp_path/'outbox')
        assert len(token) >= 43
        assert token not in json.dumps(payload)
        assert (tmp_path/'outbox').stat().st_mode & 0o777 == 0o700
        assert all(p.stat().st_mode & 0o777 == 0o600 for p in (tmp_path/'outbox').glob('*'))
        digest=execute(backend_database,'SELECT token_hash FROM email_verification_tokens WHERE user_id=1')[0][0]
        assert digest == hashlib.sha256(token.encode()).hexdigest()
        assert api(client,base,'POST','/api/auth/verification/request')[0] == 429
        other,_=login(base,'mentor501@test.edu')
        assert api(other,base,'POST','/api/auth/verification/confirm',{'token':token})[0] == 400
        status,user=api(client,base,'POST','/api/auth/verification/confirm',{'token':token})
        assert status == 200 and user['isVerified'] is True
        assert api(client,base,'POST','/api/auth/verification/confirm',{'token':token})[0] == 400
        assert api(client,base,'GET','/api/chat/rooms')[0] == 200


def test_resend_last_delivered_wins_expiry_and_failure_preserves_previous(backend_database,backend_server,monkeypatch,tmp_path):
    unverify(backend_database)
    monkeypatch.setenv('EMAIL_DELIVERY_MODE','development-file')
    monkeypatch.setenv('EMAIL_DEV_OUTBOX_DIR',str(tmp_path/'outbox'))
    monkeypatch.setenv('APP_ORIGIN','http://localhost:5173')
    with backend_server() as base:
        client,_=login(base,'student001@test.edu')
        assert api(client,base,'POST','/api/auth/verification/request')[0] == 202
        first=token_from(tmp_path/'outbox')
        execute(backend_database,"UPDATE email_verification_requests SET requested_at=now()-interval '61 seconds'")
        assert api(client,base,'POST','/api/auth/verification/request')[0] == 202
        second=token_from(tmp_path/'outbox')
        assert api(client,base,'POST','/api/auth/verification/confirm',{'token':first})[0] == 400
        execute(backend_database,"UPDATE email_verification_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=%s",(hashlib.sha256(second.encode()).hexdigest(),))
        assert api(client,base,'POST','/api/auth/verification/confirm',{'token':second})[0] == 400
        execute(backend_database,"UPDATE email_verification_requests SET requested_at=now()-interval '61 seconds'")
        assert api(client,base,'POST','/api/auth/verification/request')[0] == 202
        good=token_from(tmp_path/'outbox')
        execute(backend_database,"UPDATE email_verification_requests SET requested_at=now()-interval '61 seconds'")
        # A real filesystem delivery error, while the previous delivered token remains valid.
        for p in (tmp_path/'outbox').glob('*'): p.unlink()
        (tmp_path/'outbox').rmdir()
        (tmp_path/'outbox').write_text('not a directory')
        assert api(client,base,'POST','/api/auth/verification/request')[0] == 503
        assert api(client,base,'POST','/api/auth/verification/confirm',{'token':good})[0] == 200


def test_disabled_delivery_explicit_and_anonymous_denied(backend_server,monkeypatch):
    monkeypatch.setenv('EMAIL_DELIVERY_MODE','disabled')
    with backend_server() as base:
        assert api(build_opener(),base,'POST','/api/auth/verification/request')[0] == 401
        client,_=login(base,'student001@test.edu')
        assert api(client,base,'POST','/api/auth/verification/request')[0] == 503


def test_confirmation_errors_never_echo_token_and_invalid_attempts_are_bounded(backend_server):
    with backend_server() as base:
        client,_=login(base,'student001@test.edu')
        bad='raw-secret-token-that-must-not-echo'
        status,result=api(client,base,'POST','/api/auth/verification/confirm',{'token':bad})
        assert status==422
        assert bad not in json.dumps(result)
        for _ in range(10):
            assert api(client,base,'POST','/api/auth/verification/confirm',{'token':'A'*43})[0]==400
        assert api(client,base,'POST','/api/auth/verification/confirm',{'token':'A'*43})[0]==429


def test_concurrent_resend_and_confirm_are_serialized(backend_database,backend_server,monkeypatch,tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    unverify(backend_database)
    monkeypatch.setenv('EMAIL_DELIVERY_MODE','development-file')
    monkeypatch.setenv('EMAIL_DEV_OUTBOX_DIR',str(tmp_path/'outbox'))
    monkeypatch.setenv('APP_ORIGIN','http://localhost:5173')
    with backend_server() as base:
        clients=[login(base,'student001@test.edu')[0] for _ in range(2)]
        with ThreadPoolExecutor(2) as workers:
            statuses=list(workers.map(lambda client:api(client,base,'POST','/api/auth/verification/request')[0],clients))
        assert sorted(statuses)==[202,429]
        token=token_from(tmp_path/'outbox')
        with ThreadPoolExecutor(2) as workers:
            statuses=list(workers.map(lambda client:api(client,base,'POST','/api/auth/verification/confirm',{'token':token})[0],clients))
        assert sorted(statuses)==[200,400]
        assert execute(backend_database,'SELECT count(*) FROM email_verification_tokens')[0][0]==0


def test_verification_hourly_ceiling_and_stale_sessions(backend_database,backend_server,monkeypatch,tmp_path):
    monkeypatch.setenv('EMAIL_DELIVERY_MODE','development-file')
    monkeypatch.setenv('EMAIL_DEV_OUTBOX_DIR',str(tmp_path/'outbox'))
    monkeypatch.setenv('APP_ORIGIN','http://localhost:5173')
    with backend_server() as base:
        client,_=login(base,'student001@test.edu')
        for _ in range(5):
            execute(backend_database,"UPDATE email_verification_requests SET requested_at=now()-interval '61 seconds'")
            assert api(client,base,'POST','/api/auth/verification/request')[0]==202
        execute(backend_database,"UPDATE email_verification_requests SET requested_at=now()-interval '61 seconds'")
        assert api(client,base,'POST','/api/auth/verification/request')[0]==429
        assert execute(backend_database,'SELECT count(*) FROM email_verification_tokens')[0][0]==1
        # Deleting an account must revoke an existing signed session immediately.
        result=api(client,base,'POST','/api/auth/register',{'email':'gone@test.edu','name':'Gone','password':'Password123!','role':'mentee','districtId':1})
        # build_opener doesn't retain this registration cookie: log in explicitly.
        client,_=login(base,'gone@test.edu')
        execute(backend_database,"DELETE FROM users WHERE email='gone@test.edu'")
        assert api(client,base,'GET','/api/auth/me')[0]==401


@pytest.mark.parametrize('socket_path,send_path',[('/ws/chat/rooms/1','/api/chat/rooms/1/messages'),('/ws/dms/1','/api/dms/1/messages')])
def test_websocket_ownership_at_handshake_send_and_recipient_broadcast(backend_database,backend_server,socket_path,send_path):
    from websockets.sync.client import connect
    from websockets.exceptions import ConnectionClosed, InvalidStatus
    with backend_server() as base:
        student,cookie=login(base,'student001@test.edu')
        mentor,mentor_cookie=login(base,'mentor501@test.edu')
        url=base.replace('http://','ws://')+socket_path
        with connect(url,additional_headers={'Cookie':cookie},open_timeout=3) as sender, connect(url,additional_headers={'Cookie':mentor_cookie},open_timeout=3) as recipient:
            unverify(backend_database,501)
            sender.send('not for revoked recipient')
            assert json.loads(sender.recv(timeout=3))['body']=='not for revoked recipient'
            with pytest.raises(ConnectionClosed): recipient.recv(timeout=3)
            unverify(backend_database,1)
            sender.send('revoked sender')
            with pytest.raises(ConnectionClosed): sender.recv(timeout=3)
        with pytest.raises(InvalidStatus):
            connect(url,additional_headers={'Cookie':cookie},open_timeout=3)
        assert execute(backend_database,"SELECT count(*) FROM "+('chat_messages' if '/chat/' in socket_path else 'dm_messages')+" WHERE body='revoked sender'")[0][0]==0


def test_limits_survive_restart_and_development_delivery_refused_in_production(backend_database,backend_server,monkeypatch,tmp_path):
    monkeypatch.setenv('EMAIL_DELIVERY_MODE','development-file')
    monkeypatch.setenv('EMAIL_DEV_OUTBOX_DIR',str(tmp_path/'outbox'))
    monkeypatch.setenv('APP_ORIGIN','http://localhost:5173')
    with backend_server() as base:
        client,_=login(base,'student001@test.edu')
        assert api(client,base,'POST','/api/auth/verification/request')[0]==202
    with backend_server() as base:
        client,_=login(base,'student001@test.edu')
        assert api(client,base,'POST','/api/auth/verification/request')[0]==429
    # Session cookie is secure in production: use a signed test cookie over loopback.
    from itsdangerous import TimestampSigner
    import base64
    cookie=TimestampSigner('chat-integration-test').sign(base64.b64encode(json.dumps({'user_id':501}).encode())).decode()
    client=build_opener()
    client.addheaders=[('Cookie','peerbridge_session='+cookie)]
    with backend_server(environment={'NODE_ENV':'production'}) as base:
        assert api(client,base,'POST','/api/auth/verification/request')[0]==503
        assert len(list((tmp_path/'outbox').glob('*.json')))==1


def test_existing_dm_recipient_newly_blocked_gets_no_broadcast(backend_database,backend_server):
    from websockets.sync.client import connect
    from websockets.exceptions import ConnectionClosed
    with backend_server() as base:
        student,cookie=login(base,'student001@test.edu')
        mentor,mentor_cookie=login(base,'mentor501@test.edu')
        root=base.replace('http://','ws://')
        with connect(root+'/ws/dms/1',additional_headers={'Cookie':cookie}) as recipient:
            execute(backend_database,'INSERT INTO blocks(blocker_id,blocked_user_id) VALUES (501,1)')
            assert api(mentor,base,'POST','/api/dms/1/messages',{'body':'blocked payload'})[0]==403
            # Another REST send must not broadcast to a newly blocked peer either.
            recipient.send('blocked sender')
            with pytest.raises(ConnectionClosed): recipient.recv(timeout=3)
        assert execute(backend_database,"SELECT count(*) FROM dm_messages WHERE body IN ('blocked payload','blocked sender')")[0][0]==0


def test_token_binds_current_email_and_validation_redacts_extra_inputs(backend_database,backend_server,monkeypatch,tmp_path):
    unverify(backend_database)
    monkeypatch.setenv('EMAIL_DELIVERY_MODE','development-file')
    monkeypatch.setenv('EMAIL_DEV_OUTBOX_DIR',str(tmp_path/'outbox'))
    monkeypatch.setenv('APP_ORIGIN','http://localhost:5173')
    with backend_server() as base:
        client,_=login(base,'student001@test.edu')
        assert api(client,base,'POST','/api/auth/verification/request')[0]==202
        token=token_from(tmp_path/'outbox')
        for body in ({'token':token,'unknown':token},{'token':token*20},{'unknown':token}):
            status,result=api(client,base,'POST','/api/auth/verification/confirm',body)
            assert status==422 and token not in json.dumps(result)
        execute(backend_database,"UPDATE users SET email='changed@test.edu' WHERE id=1")
        assert api(client,base,'POST','/api/auth/verification/confirm',{'token':token})[0]==400
        assert api(client,base,'GET','/api/auth/me')[1]['isVerified'] is False


def test_anonymous_session_routes_authenticate_before_body_validation(backend_server):
    with backend_server() as base:
        anonymous=build_opener()
        assert api(anonymous,base,'POST','/api/auth/verification/confirm',{'token':'invalid'})[0]==401
        assert api(anonymous,base,'PATCH','/api/users/1',{'isAdmin':True})[0]==401
