"""Only two explicitly designated synthetic accounts may skip ownership for members."""
from datetime import datetime, timezone
import hashlib
import json

import pytest
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect

from backend_support import api, login
from routers.auth import format_user
from test_account_trust import execute, unverify


ORIGIN = 'https://mentor-connect-test.onrender.com'
CONFIG = {
    'TEST_MEMBER_ACCESS_ENABLED': 'true',
    'TEST_MEMBER_MENTOR_ID': '501',
    'TEST_MEMBER_MENTEE_ID': '1',
    'APP_ORIGIN': ORIGIN,
    'GATEWAY_PUBLIC_ORIGIN': ORIGIN,
}


@pytest.fixture
def enabled_policy(monkeypatch):
    for key, value in CONFIG.items():
        monkeypatch.setenv(key, value)


def row(user_id=1, role='mentee', **changes):
    return dict(id=user_id, role=role, name='Synthetic member', email='synthetic@example.edu',
                district_id=1, district_name='Synthetic district', bio=None, subjects=[],
                email_verified_at=None, is_verified=False, is_admin=False,
                created_at=datetime.now(timezone.utc), **changes)


@pytest.mark.parametrize('user_id,role', [(1, 'mentee'), (501, 'mentor')])
def test_two_bound_accounts_have_member_access_without_ownership(enabled_policy, user_id, role):
    user = row(user_id, role)
    public = format_user(user, user['district_name'])
    assert public.get('hasMemberAccess') is True
    assert public['isVerified'] is False
    assert public['isAdmin'] is False
    assert user['email_verified_at'] is None and user['is_verified'] is False


@pytest.mark.parametrize('key,value', [
    ('TEST_MEMBER_ACCESS_ENABLED', None), ('TEST_MEMBER_ACCESS_ENABLED', ''),
    ('TEST_MEMBER_ACCESS_ENABLED', 'false'), ('TEST_MEMBER_ACCESS_ENABLED', 'TRUE'),
    ('TEST_MEMBER_ACCESS_ENABLED', '1'), ('TEST_MEMBER_ACCESS_ENABLED', 'true '),
    ('TEST_MEMBER_MENTOR_ID', None), ('TEST_MEMBER_MENTEE_ID', ''),
    ('TEST_MEMBER_MENTOR_ID', '1'), ('TEST_MEMBER_MENTOR_ID', '0'),
    ('TEST_MEMBER_MENTOR_ID', '-501'), ('TEST_MEMBER_MENTOR_ID', '0501'),
    ('TEST_MEMBER_MENTOR_ID', '501 '), ('TEST_MEMBER_MENTOR_ID', '501,951'),
    ('TEST_MEMBER_MENTOR_ID', '2147483648'), ('TEST_MEMBER_MENTOR_ID', '５01'),
    ('APP_ORIGIN', None), ('APP_ORIGIN', 'http://mentor-connect-test.onrender.com'),
    ('APP_ORIGIN', ORIGIN + '/'), ('APP_ORIGIN', ORIGIN + '.evil.invalid'),
    ('GATEWAY_PUBLIC_ORIGIN', None), ('GATEWAY_PUBLIC_ORIGIN', 'https://production.example'),
    ('GATEWAY_PUBLIC_ORIGIN', 'http://localhost:5173'),
])
def test_invalid_or_disabled_configuration_fails_closed(enabled_policy, monkeypatch, key, value):
    if value is None:
        monkeypatch.delenv(key)
    else:
        monkeypatch.setenv(key, value)
    for user in (row(), row(501, 'mentor')):
        assert format_user(user, 'Synthetic district').get('hasMemberAccess') is False


@pytest.mark.parametrize('user_id,role,is_admin', [
    (951, 'mentor', False), (951, 'mentee', False), (1, 'mentor', False),
    (501, 'mentee', False), (1, 'both', False), (501, 'admin', False),
    (1, 'mentee', True), (501, 'mentor', True),
])
def test_third_account_wrong_role_or_admin_cannot_use_exception(enabled_policy, user_id, role, is_admin):
    user = row(user_id, role)
    user['is_admin'] = is_admin
    assert format_user(user, 'Synthetic district').get('hasMemberAccess') is False


def test_designated_ids_never_gain_admin_even_with_actual_ownership(enabled_policy):
    for user in (row(), row(501, 'mentor')):
        user.update(is_admin=True, email_verified_at=datetime.now(timezone.utc))
        assert format_user(user, 'Synthetic district')['isAdmin'] is False


def test_disable_is_recomputed_without_cached_authority(enabled_policy, monkeypatch):
    assert format_user(row(), 'Synthetic district').get('hasMemberAccess') is True
    monkeypatch.setenv('TEST_MEMBER_ACCESS_ENABLED', 'false')
    assert format_user(row(), 'Synthetic district').get('hasMemberAccess') is False


def test_test_members_chat_discovery_matching_and_revocation(backend_database, backend_server):
    for user_id in (1, 501, 951):
        unverify(backend_database, user_id)
    with backend_server(environment=CONFIG) as base:
        mentee, cookie = login(base, 'student001@test.edu')
        mentor, _ = login(base, 'mentor501@test.edu')
        third, _ = login(base, 'both951@test.edu')
        for client in (mentee, mentor):
            user = api(client, base, 'GET', '/api/auth/me')[1]
            assert user.get('hasMemberAccess') is True
            assert user['isVerified'] is False and user['isAdmin'] is False
            for path in ('/api/chat/rooms', '/api/requests', '/api/tags', '/api/blocks'):
                assert api(client, base, 'GET', path)[0] == 200, path
            assert api(client, base, 'GET', '/api/admin/reports')[0] == 403
        assert api(third, base, 'GET', '/api/chat/rooms')[0] == 403
        assert [u['id'] for u in api(mentee, base, 'GET', '/api/mentors')[1]] == [501]
        assert api(mentee, base, 'GET', '/api/users/501')[0] == 200
        status, request = api(mentee, base, 'POST', '/api/requests', {
            'districtId': 1, 'title': 'Synthetic test access', 'description': 'Synthetic match', 'role': 'mentee',
        })
        assert status == 201
        path = f"/api/requests/{request['id']}/applications"
        status, application = api(mentor, base, 'POST', path)
        assert status == 200
        assert api(mentee, base, 'PATCH', path + f"/{application['id']}", {'action': 'accept'})[0] == 200
        assert api(mentee, base, 'GET', '/api/connections')[1][0]['userId'] == 501
        socket_url = base.replace('http://', 'ws://') + '/ws/chat/rooms/1'
        with connect(socket_url, additional_headers={'Cookie': cookie}) as socket:
            socket.send('Synthetic exempt member message')
            assert json.loads(socket.recv(timeout=3))['senderId'] == 1
            execute(backend_database, "UPDATE users SET role='both' WHERE id=1")
            assert api(mentee, base, 'GET', '/api/chat/rooms')[0] == 403
            socket.send('Revoked test access')
            with pytest.raises(ConnectionClosed):
                socket.recv(timeout=3)
        with pytest.raises(InvalidStatus):
            connect(socket_url, additional_headers={'Cookie': cookie})
        execute(backend_database, 'UPDATE users SET is_admin=true,is_verified=true,email_verified_at=now() WHERE id=501')
        assert api(mentor, base, 'GET', '/api/auth/me')[1]['isAdmin'] is False
        assert api(mentor, base, 'GET', '/api/admin/reports')[0] == 403
    assert execute(backend_database, 'SELECT email_verified_at,is_verified FROM users WHERE id=1') == [(None, False)]
    # A restart with disabled configuration revokes the still-signed account session.
    execute(backend_database, "UPDATE users SET role='mentee' WHERE id=1")
    with backend_server(environment={**CONFIG, 'TEST_MEMBER_ACCESS_ENABLED': 'false'}) as base:
        mentee.addheaders = [('Cookie', cookie)]
        assert api(mentee, base, 'GET', '/api/chat/rooms')[0] == 403


def test_verified_normal_account_keeps_ownership_after_login_and_token_expiry(backend_database, backend_server):
    original = execute(backend_database, 'SELECT email_verified_at FROM users WHERE id=951')[0][0]
    token = 'a' * 43
    execute(backend_database, """INSERT INTO email_verification_tokens(user_id,email,token_hash,expires_at)
        VALUES (951,'both951@test.edu',%s,now()-interval '1 hour')""", (hashlib.sha256(token.encode()).hexdigest(),))
    with backend_server(environment=CONFIG) as base:
        member, _ = login(base, 'both951@test.edu')
        assert api(member, base, 'POST', '/api/auth/verification/confirm', {'token': token})[0] == 400
        assert api(member, base, 'POST', '/api/auth/logout')[0] == 200
        member, _ = login(base, 'both951@test.edu')
        user = api(member, base, 'GET', '/api/auth/me')[1]
        assert user['isVerified'] is True and user.get('hasMemberAccess') is True
        assert api(member, base, 'GET', '/api/chat/rooms')[0] == 200
    assert execute(backend_database, 'SELECT email_verified_at FROM users WHERE id=951') == [(original,)]


@pytest.mark.parametrize('path', ['/ws/chat/rooms/1', '/ws/dms/1'])
def test_gateway_test_member_sockets_recheck_database_and_admin_stays_denied(
        request, backend_database, enabled_policy, path):
    for user_id in (1, 501, 951):
        unverify(backend_database, user_id)
    base = request.getfixturevalue('gateway_server')
    student, cookie = login(base, 'student001@test.edu')
    mentor, _ = login(base, 'mentor501@test.edu')
    assert api(student, base, 'GET', '/api/mentors')[0] == 200
    assert api(student, base, 'GET', '/api/auth/me')[1]['hasMemberAccess'] is True
    with connect(base.replace('http://', 'ws://') + path, origin='http://127.0.0.1:14200',
                 additional_headers={'Cookie': cookie}) as socket:
        socket.send('Synthetic gateway test access')
        assert json.loads(socket.recv(timeout=3))['senderId'] == 1
        execute(backend_database, 'UPDATE users SET is_admin=true WHERE id=1')
        assert api(student, base, 'GET', '/api/chat/rooms')[0] == 403
        socket.send('Synthetic revoked gateway access')
        with pytest.raises(ConnectionClosed):
            socket.recv(timeout=3)
    execute(backend_database, 'UPDATE users SET is_admin=true,is_verified=true,email_verified_at=now() WHERE id=501')
    for operation in ('/api/admin/reports', '/api/practice/status', '/api/analytics/weekly-matches',
                      '/api/scheduling/status', '/api/python-reports/status', '/api/analysis/status', '/api/matches/1'):
        assert api(mentor, base, 'GET', operation)[0] == 403, operation


def test_client_fields_and_session_claims_cannot_obtain_test_member_access(backend_database, backend_server):
    from base64 import b64encode
    from itsdangerous import TimestampSigner
    from urllib.request import build_opener
    unverify(backend_database, 951)
    with backend_server(environment=CONFIG) as base:
        third, _ = login(base, 'both951@test.edu')
        for field in ('hasMemberAccess', 'isTestAccount', 'isAdmin', 'email_verified_at', 'TEST_MEMBER_ACCESS_ENABLED'):
            assert api(third, base, 'PATCH', '/api/users/951', {field: True})[0] == 422
            assert api(third, base, 'POST', '/api/auth/register', {
                'email': 'synthetic-new@example.edu', 'name': 'Synthetic member',
                'password': 'Synthetic-password123!', 'role': 'mentor', 'districtId': 1, field: True,
            })[0] == 422
        # Even a valid signature over stale/forged privilege attributes is insufficient.
        claims = {'user_id': 951, 'role': 'mentor', 'hasMemberAccess': True, 'isVerified': True,
                  'isAdmin': True, 'isTestAccount': True}
        cookie = TimestampSigner('chat-integration-test').sign(b64encode(json.dumps(claims).encode())).decode()
        client = build_opener()
        client.addheaders = [('Cookie', 'peerbridge_session=' + cookie)]
        assert api(client, base, 'GET', '/api/auth/me')[1]['hasMemberAccess'] is False
        assert api(client, base, 'GET', '/api/chat/rooms')[0] == 403
        assert api(client, base, 'GET', '/api/admin/reports')[0] == 403
        # The policy does not alter signup eligibility or grant new registrations access.
        assert api(client, base, 'POST', '/api/auth/register', {
            'email': 'synthetic-new@example.com', 'name': 'Synthetic member',
            'password': 'Synthetic-password123!', 'role': 'mentor', 'districtId': 1,
        })[0] == 422
        status, payload = api(client, base, 'POST', '/api/auth/register', {
            'email': 'synthetic-new@example.edu', 'name': 'Synthetic member',
            'password': 'Synthetic-password123!', 'role': 'mentor', 'districtId': 1,
        })
        assert status == 201
        assert payload['user']['hasMemberAccess'] is False
        assert payload['user']['isVerified'] is False and payload['user']['isAdmin'] is False
