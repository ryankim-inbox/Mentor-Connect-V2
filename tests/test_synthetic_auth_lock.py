"""Seeded synthetic identities cannot become sessions, members, admins, or recipients."""
import json

import pytest
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect

from backend_support import api, login
from routers.auth import format_user
from test_account_trust import execute, unverify
from test_test_member_access import CONFIG, row


LOCKED_HASH = '!mentor-connect-synthetic:v1:mc-synthetic-v1-983-782'


@pytest.mark.parametrize('password_hash', [LOCKED_HASH, 'malformed-bcrypt'])
def test_locked_or_invalid_password_hash_returns_401(backend_database, backend_server, password_hash):
    from urllib.request import build_opener
    execute(backend_database, 'UPDATE users SET password_hash=%s WHERE id=1', (password_hash,))
    with backend_server() as base:
        status, payload = api(build_opener(), base, 'POST', '/api/auth/login', {
            'email': 'student001@test.edu', 'password': 'Password123!',
        })
        assert status == 401
        assert password_hash not in json.dumps(payload)


def test_synthetic_lock_revokes_existing_session_sockets_and_mail(backend_database, backend_server):
    unverify(backend_database)
    with backend_server(environment=CONFIG) as base:
        client, cookie = login(base, 'student001@test.edu')
        execute(backend_database, 'UPDATE users SET password_hash=%s WHERE id=1', (LOCKED_HASH,))
        for path in ('/api/auth/me', '/api/users/1', '/api/chat/rooms', '/api/admin/reports'):
            assert api(client, base, 'GET', path)[0] == 401, path
        assert api(client, base, 'POST', '/api/auth/verification/request')[0] == 401
        assert api(client, base, 'POST', '/api/auth/verification/confirm', {'token': 'a' * 43})[0] == 401
        with pytest.raises(InvalidStatus):
            connect(base.replace('http://', 'ws://') + '/ws/chat/rooms/1', additional_headers={'Cookie': cookie})
        assert execute(backend_database, 'SELECT count(*) FROM email_verification_requests WHERE user_id=1') == [(0,)]


def test_synthetic_row_cannot_use_configured_test_exception_or_admin(monkeypatch):
    from datetime import datetime, timezone
    for key, value in CONFIG.items():
        monkeypatch.setenv(key, value)
    user = row(password_hash=LOCKED_HASH)
    assert format_user(user, 'Synthetic district')['hasMemberAccess'] is False
    user.update(email_verified_at=datetime.now(timezone.utc), is_admin=True)
    assert format_user(user, 'Synthetic district')['hasMemberAccess'] is False
    assert format_user(user, 'Synthetic district')['isAdmin'] is False


def test_locked_designated_mentor_is_not_discoverable_as_an_exempt_member(backend_database, backend_server):
    unverify(backend_database, 501)
    execute(backend_database, 'UPDATE users SET password_hash=%s WHERE id=501', (LOCKED_HASH,))
    with backend_server(environment=CONFIG) as base:
        client, _ = login(base, 'student001@test.edu')
        assert api(client, base, 'GET', '/api/mentors') == (200, [])
