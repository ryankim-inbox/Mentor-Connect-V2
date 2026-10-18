"""Student/admin separation against real HTTP, PostgreSQL and WebSocket paths."""
import json
import uuid

import pytest
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect

from backend_support import api, login
from test_account_trust import execute

ORIGIN = 'http://127.0.0.1:14200'


@pytest.mark.parametrize('email', ['student001@test.edu', 'mentor501@test.edu', 'both951@test.edu'])
def test_students_cannot_read_admin_aggregates_or_reports(gateway_server, email):
    client, _ = login(gateway_server, email)
    for path in ('/api/stats/overview', '/api/stats/district/1', '/api/admin/reports'):
        assert api(client, gateway_server, 'GET', path)[0] == 403, path


@pytest.mark.parametrize('via_gateway', [False, True])
def test_admin_student_mutations_are_denied_before_target_lookup(backend_database, backend_server, gateway_server, via_gateway):
    execute(backend_database, 'UPDATE users SET is_admin=true WHERE id=1')
    with backend_server() as backend:
        base = gateway_server if via_gateway else backend
        client, _ = login(base, 'student001@test.edu')
        assert api(client, base, 'GET', '/api/admin/reports')[0] == 200
        operations = [
            ('POST', '/api/requests', {'districtId':1,'title':'Admin must not publish','description':'Synthetic authority test','role':'mentee'}),
            ('PATCH', '/api/requests/9999', {'title':'Admin must not edit student posts'}),
            ('POST', '/api/requests/9999/comments', {'body':'Admin must not reply','clientCommentId':str(uuid.uuid4())}),
            ('PATCH', '/api/requests/9999/comments/9999', {'body':'Admin must not edit replies'}),
            ('POST', '/api/requests/9999/applications', None),
            ('PATCH', '/api/requests/9999/applications/9999', {'action':'accept'}),
            ('POST', '/api/requests/9999/match', None),
            ('POST', '/api/chat/rooms/1/messages', {'body':'Admin must not chat','clientMessageId':str(uuid.uuid4())}),
            ('POST', '/api/dms/1/messages', {'body':'Admin must not DM','clientMessageId':str(uuid.uuid4())}),
            ('POST', '/api/dms/start', {'toUserId':501}),
            ('POST', '/api/reports', {'reportedUserId':501,'reason':'spam'}),
            ('POST', '/api/blocks', {'blockedUserId':501}),
            ('PATCH', '/api/users/1', {'role':'both'}),
        ]
        for method, path, payload in operations:
            status, body = api(client, base, method, path, payload)
            assert status == 403, (method, path, status, body)
        for path in ('/api/chat/rooms', '/api/dms', '/api/notifications', '/api/connections'):
            assert api(client, base, 'GET', path)[0] == 403, path


@pytest.mark.parametrize('path', ['/ws/chat/rooms/1', '/ws/dms/1'])
def test_admin_cannot_handshake_student_socket(gateway_server, backend_database, path):
    client, cookie = login(gateway_server, 'student001@test.edu')
    execute(backend_database, 'UPDATE users SET is_admin=true WHERE id=1')
    assert api(client, gateway_server, 'GET', '/api/auth/me')[1]['isAdmin'] is True
    with pytest.raises(InvalidStatus) as denied:
        connect(gateway_server.replace('http:', 'ws:')+path, origin=ORIGIN, additional_headers={'Cookie':cookie})
    assert denied.value.response.status_code == 403


@pytest.mark.parametrize('path,table', [('/ws/chat/rooms/1','chat_messages'),('/ws/dms/1','dm_messages')])
def test_open_student_socket_loses_send_authority_after_admin_promotion(gateway_server, backend_database, path, table):
    _, cookie = login(gateway_server, 'student001@test.edu')
    with connect(gateway_server.replace('http:', 'ws:')+path, origin=ORIGIN, additional_headers={'Cookie':cookie}) as socket:
        execute(backend_database, 'UPDATE users SET is_admin=true WHERE id=1')
        before = execute(backend_database, f'SELECT count(*) FROM {table}')[0][0]
        socket.send('Synthetic message after administrator promotion')
        with pytest.raises(ConnectionClosed):
            socket.recv(timeout=3)
        assert execute(backend_database, f'SELECT count(*) FROM {table}')[0][0] == before


def test_admin_can_moderate_but_never_replace_reply_text(gateway_server, backend_database):
    student, _ = login(gateway_server, 'student001@test.edu')
    mentor, _ = login(gateway_server, 'mentor501@test.edu')
    status, request = api(student, gateway_server, 'POST', '/api/requests', {'districtId':1,'title':'Moderation target','description':'Synthetic moderation target','role':'mentee'})
    assert status == 201
    status, comment = api(mentor, gateway_server, 'POST', f"/api/requests/{request['id']}/comments", {'body':'Synthetic original reply','clientCommentId':str(uuid.uuid4())})
    assert status == 201
    execute(backend_database, 'UPDATE users SET is_admin=true WHERE id=1')
    path = f"/api/requests/{request['id']}/comments/{comment['id']}"
    assert api(student, gateway_server, 'PATCH', path, {'body':'Administrator replacement'})[0] == 403
    assert api(student, gateway_server, 'DELETE', path)[0] == 200
    assert execute(backend_database, 'SELECT body,deleted_at IS NOT NULL FROM request_comments WHERE id=%s', (comment['id'],)) == [('', True)]
