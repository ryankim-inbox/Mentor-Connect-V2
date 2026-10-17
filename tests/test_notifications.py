"""Real member notifications, consent boundaries and the non-DDL runtime role."""
from contextlib import closing, contextmanager
import uuid

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import make_dsn
import pytest

from backend_support import api, login
from test_account_trust import execute, unverify
from test_test_member_access import CONFIG

@pytest.fixture
def notification_schema(backend_database):
    # The canonical database setup must apply 0007; tests never repair missing DDL.
    assert execute(backend_database, "SELECT to_regclass('public.notifications')")[0][0] is not None
    return backend_database


def create_request(client, base, title='Notification consent check'):
    status, request = api(client, base, 'POST', '/api/requests', {
        'districtId': 1, 'title': title, 'description': 'Local synthetic notification test',
        'role': 'mentee', 'tagIds': [1], 'preferredTimes': ['Mon 16:00'],
    })
    assert status == 201, request
    return request


@contextmanager
def runtime_role(dsn):
    role = 'notifications_test_' + uuid.uuid4().hex
    with closing(psycopg2.connect(dsn)) as conn, conn.cursor() as cur:
        cur.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
        cur.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(role)))
        cur.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA public TO {}').format(sql.Identifier(role)))
        cur.execute(sql.SQL('GRANT INSERT ON requests,request_tags,request_submission_keys,notifications TO {}').format(sql.Identifier(role)))
        cur.execute(sql.SQL('GRANT UPDATE(read_at) ON notifications TO {}').format(sql.Identifier(role)))
        # Row-level delivery locks need an UPDATE privilege; never grant authority fields.
        cur.execute(sql.SQL('GRANT UPDATE(title) ON requests TO {}').format(sql.Identifier(role)))
        cur.execute(sql.SQL('GRANT UPDATE(name) ON users TO {}').format(sql.Identifier(role)))
        cur.execute(sql.SQL('GRANT USAGE ON SEQUENCE requests_id_seq,request_tags_id_seq,notifications_id_seq TO {}').format(sql.Identifier(role)))
        conn.commit()
        try:
            yield make_dsn(dsn, user=role)
        finally:
            cur.execute(sql.SQL('DROP OWNED BY {}').format(sql.Identifier(role)))
            cur.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))
            conn.commit()


def test_notifications_work_without_runtime_ddl_or_admin_writes(notification_schema, backend_server):
    before_dm = execute(notification_schema, 'SELECT count(*) FROM dm_conversations')[0][0]
    with runtime_role(notification_schema) as dsn, backend_server(database_url=dsn) as base:
        student, _ = login(base, 'student001@test.edu')
        mentor, _ = login(base, 'mentor501@test.edu')
        request = create_request(student, base)
        assert request['status'] == 'open' and request['matchedUserId'] is None
        status, inbox = api(mentor, base, 'GET', '/api/notifications')
        assert status == 200, inbox
        assert any(item['kind'] == 'request_match' and item['requestId'] == request['id'] for item in inbox['items'])
        assert api(mentor, base, 'POST', '/api/notifications/read')[0] == 204
        assert api(mentor, base, 'GET', '/api/notifications')[1]['unreadCount'] == 0
        assert execute(notification_schema, 'SELECT count(*) FROM request_applications')[0][0] == 0
        assert execute(notification_schema, "SELECT count(*) FROM request_events WHERE kind='matched'")[0][0] == 0
        assert execute(notification_schema, 'SELECT count(*) FROM dm_conversations')[0][0] == before_dm


def test_two_test_members_receive_notifications_but_synthetic_and_unverified_candidates_do_not(notification_schema, backend_server):
    unverify(notification_schema, 1)
    unverify(notification_schema, 501)
    unverify(notification_schema, 502)
    execute(notification_schema, 'DELETE FROM blocks WHERE blocker_id=1 AND blocked_user_id=502')
    execute(notification_schema, "UPDATE users SET password_hash='!mentor-connect-synthetic:v1:notification-test',district_id=1 WHERE id=951")
    with backend_server(environment=CONFIG) as base:
        student, _ = login(base, 'student001@test.edu')
        mentor, _ = login(base, 'mentor501@test.edu')
        request = create_request(student, base)
        assert api(student, base, 'GET', '/api/notifications')[0] == 200
        status, inbox = api(mentor, base, 'GET', '/api/notifications')
        assert status == 200, inbox
        assert any(item['requestId'] == request['id'] for item in inbox['items'])
        assert execute(notification_schema, 'SELECT count(*) FROM notifications WHERE user_id IN (502,951)')[0][0] == 0
        unverify(notification_schema, 501)
        execute(notification_schema, "UPDATE users SET role='both' WHERE id=501")
        assert api(mentor, base, 'GET', '/api/notifications')[0] == 403
        create_request(student, base, 'No currently eligible mentor')
        assert execute(notification_schema, "SELECT count(*) FROM notifications WHERE kind='request_match'")[0][0] == 1


def test_inboxes_are_self_only_bounded_and_mark_only_the_current_user(notification_schema, backend_server):
    execute(notification_schema, """INSERT INTO notifications(user_id,kind,message)
        SELECT 1,'request_match_summary','Synthetic notification '||n FROM generate_series(1,55) n;
        INSERT INTO notifications(user_id,kind,message) VALUES (501,'request_match','Other member notification')""")
    with backend_server() as base:
        student, _ = login(base, 'student001@test.edu')
        mentor, _ = login(base, 'mentor501@test.edu')
        status, inbox = api(student, base, 'GET', '/api/notifications')
        assert status == 200 and len(inbox['items']) == 50 and inbox['unreadCount'] == 55
        assert [item['id'] for item in inbox['items']] == sorted([item['id'] for item in inbox['items']], reverse=True)
        assert all(item['message'].startswith('Synthetic notification ') for item in inbox['items'])
        assert api(student, base, 'POST', '/api/notifications/read')[0] == 204
        assert api(student, base, 'GET', '/api/notifications')[1]['unreadCount'] == 0
        assert api(mentor, base, 'GET', '/api/notifications')[1]['unreadCount'] == 1


def test_blocks_and_synthetic_session_revocation_apply_to_notifications(notification_schema, backend_server):
    execute(notification_schema, 'INSERT INTO blocks(blocker_id,blocked_user_id) VALUES (501,1)')
    with backend_server() as base:
        student, _ = login(base, 'student001@test.edu')
        mentor, _ = login(base, 'mentor501@test.edu')
        create_request(student, base)
        assert api(mentor, base, 'GET', '/api/notifications')[1]['items'] == []
        execute(notification_schema, "UPDATE users SET password_hash='!mentor-connect-synthetic:v1:notification-test' WHERE id=501")
        assert api(mentor, base, 'GET', '/api/notifications')[0] == 401
        assert api(mentor, base, 'POST', '/api/notifications/read')[0] == 401


def test_notification_contract_through_real_gateway(notification_schema, gateway_server):
    student, _ = login(gateway_server, 'student001@test.edu')
    mentor, _ = login(gateway_server, 'mentor501@test.edu')
    request = create_request(student, gateway_server, 'A real gateway notification')
    status, inbox = api(mentor, gateway_server, 'GET', '/api/notifications')
    assert status == 200 and inbox['unreadCount'] == 1
    item = inbox['items'][0]
    assert item['requestId'] == request['id'] and item['read'] is False
    assert set(item) == {'id', 'kind', 'requestId', 'message', 'createdAt', 'read'}
    assert api(mentor, gateway_server, 'POST', '/api/notifications/read') == (204, '')
    assert api(mentor, gateway_server, 'GET', '/api/notifications')[1]['unreadCount'] == 0
    unverify(notification_schema, 501)
    assert api(mentor, gateway_server, 'GET', '/api/notifications')[0] == 403
    assert api(mentor, gateway_server, 'POST', '/api/notifications/read')[0] == 403
