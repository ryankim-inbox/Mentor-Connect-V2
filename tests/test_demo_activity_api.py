"""Profile badges enforce fresh member eligibility across backend and gateway."""
from urllib.request import build_opener

import pytest

from backend_support import api, login
from test_account_trust import execute


@pytest.mark.parametrize('via_gateway', [False, True])
def test_activity_badge_has_member_gate_and_private_target_filter(backend_database, backend_server, gateway_server, via_gateway):
    with backend_server() as backend:
        base = gateway_server if via_gateway else backend
        path = '/api/users/501/activity-rank'
        assert api(build_opener(), base, 'GET', path)[0] == 401
        client, _ = login(base, 'student001@test.edu')
        assert api(client, base, 'GET', path) == (200, {
            'userId': 501, 'distinctPartners': 0, 'rank': None, 'tier': None,
        })
        assert api(client, base, 'GET', '/api/users/999999/activity-rank')[0] == 404
        execute(backend_database, 'UPDATE users SET email_verified_at=NULL,is_verified=false WHERE id=1')
        assert api(client, base, 'GET', path)[0] == 200
        execute(backend_database, 'UPDATE users SET email_verified_at=now(),is_verified=true,is_admin=true WHERE id=1')
        assert api(client, base, 'GET', path)[0] == 200  # moderation may inspect public badges
        assert api(client, base, 'GET', '/api/users/1/activity-rank')[0] == 404
        execute(backend_database, 'UPDATE users SET email_verified_at=NULL,is_verified=false WHERE id=501')
        assert api(client, base, 'GET', path)[0] == 200
        execute(backend_database, 'UPDATE users SET email_verified_at=now(),is_verified=true WHERE id=501')
        for blocker, blocked in [(1,501),(501,1)]:
            execute(backend_database, 'INSERT INTO blocks (blocker_id,blocked_user_id) VALUES (%s,%s)', (blocker,blocked))
            assert api(client, base, 'GET', path)[0] == 404
            execute(backend_database, 'DELETE FROM blocks WHERE blocker_id=%s AND blocked_user_id=%s', (blocker,blocked))
        execute(backend_database, "UPDATE users SET password_hash='!mentor-connect-synthetic:fixture' WHERE id=501")
        assert api(client, base, 'GET', path)[0] == 404
