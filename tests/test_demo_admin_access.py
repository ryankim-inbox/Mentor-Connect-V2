"""Exact demo administrator exception; all identities and DBs here are local fixtures."""
from datetime import datetime, timezone
from urllib.request import build_opener

import pytest
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect

from backend_support import api, login
from member_access import has_admin_access, has_member_access, has_student_access
from routers.auth import format_user
from test_account_trust import execute
from test_test_member_access import row

ORIGIN = 'https://mentor-connect-test.onrender.com'
CONFIG = {'DEMO_ADMIN_USER_ID': '991', 'APP_ORIGIN': ORIGIN, 'GATEWAY_PUBLIC_ORIGIN': ORIGIN}


@pytest.fixture
def demo_admin_config(monkeypatch):
    for key, value in CONFIG.items():
        monkeypatch.setenv(key, value)


def admin_row(**changes):
    user = row(991, 'mentor')
    user.update(email='admin@test.edu', is_admin=True, **changes)
    return user


def test_exact_demo_admin_has_authority_without_changing_ownership(demo_admin_config):
    user = admin_row()
    before = dict(user)
    public = format_user(user, 'Synthetic district')
    assert public['isAdmin'] is True and public['hasMemberAccess'] is True
    assert public['isVerified'] is False
    assert not has_student_access(user)
    assert user == before


@pytest.mark.parametrize('key,value', [
    ('DEMO_ADMIN_USER_ID', None), ('DEMO_ADMIN_USER_ID', ''),
    ('DEMO_ADMIN_USER_ID', '0991'), ('DEMO_ADMIN_USER_ID', '991 '),
    ('DEMO_ADMIN_USER_ID', '991,992'), ('DEMO_ADMIN_USER_ID', '９９１'),
    ('DEMO_ADMIN_USER_ID', '992'), ('DEMO_ADMIN_USER_ID', 'true'),
    ('APP_ORIGIN', None), ('APP_ORIGIN', ORIGIN + '/'),
    ('APP_ORIGIN', ORIGIN + '.evil.invalid'), ('APP_ORIGIN', 'http://mentor-connect-test.onrender.com'),
    ('GATEWAY_PUBLIC_ORIGIN', None), ('GATEWAY_PUBLIC_ORIGIN', 'https://production.example'),
    ('GATEWAY_PUBLIC_ORIGIN', 'http://127.0.0.1:14200'),
])
def test_incomplete_or_noncanonical_configuration_fails_closed(demo_admin_config, monkeypatch, key, value):
    if value is None:
        monkeypatch.delenv(key)
    else:
        monkeypatch.setenv(key, value)
    assert not has_admin_access(admin_row())
    assert not has_member_access(admin_row())


@pytest.mark.parametrize('changes', [
    {'id': 992}, {'id': '991'}, {'email': 'Admin@test.edu'},
    {'email': 'other@test.edu'}, {'email': 'admin@test.edu.evil.invalid'},
    {'is_admin': False}, {'password_hash': '!mentor-connect-synthetic:fixture'},
])
def test_no_other_identity_or_ungranted_account_gains_authority(demo_admin_config, changes):
    user = admin_row()
    user.update(changes)
    assert not has_admin_access(user)


def test_reserved_ids_excluded_and_config_revocation_is_immediate(demo_admin_config, monkeypatch):
    user = admin_row()
    assert has_admin_access(user)
    monkeypatch.setenv('TEST_MEMBER_MENTOR_ID', '991')
    monkeypatch.setenv('TEST_MEMBER_MENTEE_ID', '1')
    assert not has_admin_access(user)
    user['email_verified_at'] = datetime.now(timezone.utc)
    assert not has_admin_access(user)
    monkeypatch.delenv('TEST_MEMBER_MENTOR_ID')
    monkeypatch.delenv('DEMO_ADMIN_USER_ID')
    user['email_verified_at'] = None
    assert not has_admin_access(user)
    user['id'] = 951
    user['email_verified_at'] = datetime.now(timezone.utc)
    assert has_admin_access(user)  # Standard verified admin needs no exception.


@pytest.mark.parametrize('via_gateway', [False, True])
def test_real_database_authority_and_revocation(request, backend_database, backend_server,
                                               demo_admin_config, via_gateway):
    # Clone only a known synthetic local fixture, never the live account or hash.
    execute(backend_database, """INSERT INTO users
        (id,email,name,password_hash,role,district_id,subjects,is_admin,is_verified)
        SELECT 991,'admin@test.edu','Synthetic demo admin',password_hash,role,district_id,subjects,true,false
        FROM users WHERE id=951""")
    with backend_server() as backend:
        base = request.getfixturevalue('gateway_server') if via_gateway else backend
        client, cookie = login(base, 'admin@test.edu')
        user = api(client, base, 'GET', '/api/auth/me')[1]
        assert user['isAdmin'] is True and user['hasMemberAccess'] is True
        assert user['isVerified'] is False
        for path in ('/api/admin/reports', '/api/stats/overview', '/api/practice/status'):
            assert api(client, base, 'GET', path)[0] == 200, path
            assert api(build_opener(), base, 'GET', path)[0] == 401
        student, _ = login(base, 'student001@test.edu')
        assert api(student, base, 'GET', '/api/admin/reports')[0] == 403
        for path in ('/api/chat/rooms', '/api/dms', '/api/dms/unread', '/api/notifications', '/api/connections'):
            assert api(client, base, 'GET', path)[0] == 403, path
        assert api(client, base, 'POST', '/api/dms/1/read', {'messageIds': [3]})[0] == 403
        assert api(client, base, 'POST', '/api/requests', {
            'districtId': 1, 'title': 'Must not publish', 'description': 'Synthetic', 'role': 'mentor',
        })[0] == 403
        assert api(client, base, 'PATCH', '/api/users/991', {'role': 'both'})[0] == 403
        for path in ('/ws/chat/rooms/1', '/ws/dms/1'):
            with pytest.raises(InvalidStatus) as denied:
                connect(base.replace('http:', 'ws:') + path, origin='http://127.0.0.1:14200',
                        additional_headers={'Cookie': cookie})
            assert denied.value.response.status_code == 403
        execute(backend_database, 'UPDATE users SET is_admin=false WHERE id=991')
        assert api(client, base, 'GET', '/api/admin/reports')[0] == 403
        assert api(client, base, 'GET', '/api/auth/me')[1]['isAdmin'] is False
    assert execute(backend_database, 'SELECT email_verified_at,is_verified FROM users WHERE id=991') == [(None, False)]
