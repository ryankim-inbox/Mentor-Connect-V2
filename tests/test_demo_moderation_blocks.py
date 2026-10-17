"""Student block preferences cannot hide reported material from moderators."""
import uuid

import pytest

from backend_support import api, login
from test_account_trust import execute


@pytest.mark.parametrize('via_gateway', [False, True])
@pytest.mark.parametrize('direction', ['student_blocks_admin', 'admin_block_before_promotion'])
def test_admin_can_inspect_and_remove_blocked_content_but_students_cannot(
        backend_database, backend_server, gateway_server, via_gateway, direction):
    with backend_server() as backend:
        base = gateway_server if via_gateway else backend
        admin, _ = login(base, 'student001@test.edu')
        author, _ = login(base, 'mentor501@test.edu')
        reporter, _ = login(base, 'both951@test.edu')
        status, post = api(author, base, 'POST', '/api/requests', {
            'districtId': 1, 'title': 'Moderation must remain visible',
            'description': 'Synthetic reported content', 'role': 'mentor',
        })
        assert status == 201
        path = f"/api/requests/{post['id']}"
        status, comment = api(author, base, 'POST', path + '/comments', {
            'body': 'Synthetic comment to inspect', 'clientCommentId': str(uuid.uuid4()),
        })
        assert status == 201
        assert api(reporter, base, 'POST', '/api/reports', {
            'reportedUserId': 501, 'requestId': post['id'], 'reason': 'other',
        })[0] == 201
        blocker, target = (author, 1) if direction == 'student_blocks_admin' else (admin, 501)
        assert api(blocker, base, 'POST', '/api/blocks', {'blockedUserId': target})[0] == 201
        assert api(admin, base, 'GET', path)[0] == 403
        assert api(admin, base, 'GET', '/api/users/501')[0] == 403
        execute(backend_database, 'UPDATE users SET is_admin=true WHERE id=1')

        status, reports = api(admin, base, 'GET', '/api/admin/reports')
        assert status == 200 and reports[0]['requestId'] == post['id']
        status, detail = api(admin, base, 'GET', path)
        assert status == 200 and detail['description'] == 'Synthetic reported content'
        assert any(row['id'] == post['id'] for row in api(admin, base, 'GET', '/api/requests')[1])
        assert api(admin, base, 'GET', '/api/users/501')[1]['id'] == 501
        assert api(admin, base, 'GET', path + '/comments')[1][0]['body'] == 'Synthetic comment to inspect'
        assert api(admin, base, 'PATCH', path + f"/comments/{comment['id']}", {'body': 'Replacement'})[0] == 403
        assert api(admin, base, 'POST', '/api/chat/rooms/1/messages', {'body': 'Admin cannot chat'})[0] == 403
        status, removed = api(admin, base, 'DELETE', path + f"/comments/{comment['id']}")
        assert status == 200 and removed['body'] == '' and removed['deletedAt']
        assert api(admin, base, 'DELETE', path)[0] == 204
        assert api(admin, base, 'GET', '/api/admin/reports')[1][0]['requestId'] is None
        execute(backend_database, 'UPDATE users SET is_admin=false WHERE id=1')
        assert api(admin, base, 'GET', '/api/users/501')[0] == 403
