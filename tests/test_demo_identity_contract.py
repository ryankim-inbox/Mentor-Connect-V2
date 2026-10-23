"""Demo labels come from canonical identities, never editable display content."""
import json
from urllib.request import build_opener
from uuid import uuid4

import pytest

from backend_support import api, login
from test_account_trust import execute


LOCK = '!mentor-connect-synthetic:v1:mc-synthetic-v1-983-782'


def seed_identities(dsn):
    execute(dsn, "UPDATE users SET name='Maya Chen',password_hash=%s WHERE id=501", (LOCK,))
    execute(dsn, "UPDATE users SET name='[Synthetic] Demo 001',bio='isDemo: true' WHERE id=1")


def assert_marker(payload, expected):
    assert payload.get('isDemo') is expected, payload
    assert 'password' not in json.dumps(payload, default=str).lower()
    assert LOCK not in json.dumps(payload, default=str)


@pytest.mark.parametrize('via_gateway', [False, True])
def test_user_demo_marker_is_server_owned_and_survives_public_projection(
        backend_database, backend_server, request, via_gateway):
    seed_identities(backend_database)
    # This real mentor's display name deliberately looks synthetic.
    execute(backend_database, 'DELETE FROM blocks')
    execute(backend_database, "UPDATE users SET name='[Synthetic] Mentor 002' WHERE id=502")
    with backend_server() as backend:
        base = request.getfixturevalue('gateway_server') if via_gateway else backend
        client, _ = login(base, 'student001@test.edu')
        for path in ('/api/auth/me', '/api/users/1'):
            status, payload = api(client, base, 'GET', path)
            assert status == 200
            assert_marker(payload, False)
        status, profile = api(client, base, 'GET', '/api/users/501')
        assert status == 200
        assert_marker(profile, True)
        assert set(profile) == {'id', 'name', 'subjects', 'createdAt', 'isDemo'}
        status, mentors = api(client, base, 'GET', '/api/mentors')
        assert status == 200
        assert [row['id'] for row in mentors] == [502]
        assert_marker(mentors[0], False)
        status, updated = api(client, base, 'PATCH', '/api/users/1', {'name': 'Demo 983'})
        assert status == 200
        assert_marker(updated, False)
        assert api(client, base, 'PATCH', '/api/users/1', {'isDemo': True})[0] in (400, 422)
        status, registered = api(build_opener(), base, 'POST', '/api/auth/register', {
            'email': 'new-demo-label@test.edu', 'name': '[Synthetic] New',
            'password': 'Password123!', 'role': 'mentee', 'districtId': 1, 'gender': 'female', 'dateOfBirth': '2008-02-29',
        })
        assert status == 201
        assert_marker(registered['user'], False)
        assert api(build_opener(), base, 'POST', '/api/auth/login', {
            'email': 'mentor501@test.edu', 'password': 'Password123!',
        })[0] == 401


@pytest.mark.parametrize('via_gateway', [False, True])
def test_request_and_related_identity_markers_follow_canonical_authors(
        backend_database, backend_server, request, via_gateway):
    seed_identities(backend_database)
    demo_request = execute(backend_database, """INSERT INTO requests
        (author_id,district_id,title,description,role,status,matched_user_id,request)
        VALUES (501,1,'[Synthetic] Existing title 001','Existing batch content','mentor','matched',1,
                'mc-synthetic-v1-983-782:question:0001')
        RETURNING id""")[0][0]
    real_request = execute(backend_database, """INSERT INTO requests
        (author_id,district_id,title,description,role,status,matched_user_id)
        VALUES (1,1,'[Synthetic] Real request','isDemo: true','mentee','matched',501)
        RETURNING id""")[0][0]
    parent = execute(backend_database, """INSERT INTO request_comments
        (request_id,author_id,body,client_comment_id) VALUES (%s,501,'A normal question',%s)
        RETURNING id""", (real_request, str(uuid4())))[0][0]
    execute(backend_database, """INSERT INTO request_comments
        (request_id,author_id,parent_id,body,client_comment_id)
        VALUES (%s,1,%s,'[Synthetic] A real reply',%s)""", (real_request, parent, str(uuid4())))
    execute(backend_database, "INSERT INTO request_applications(request_id,applicant_id) VALUES (%s,501)", (real_request,))
    with backend_server() as backend:
        base = request.getfixturevalue('gateway_server') if via_gateway else backend
        client, _ = login(base, 'student001@test.edu')
        for path in ('/api/requests?status=matched', '/api/request-activity'):
            status, rows = api(client, base, 'GET', path)
            assert status == 200
            assert {row['id'] for row in rows} == {demo_request, real_request}
            for row in rows:
                assert_marker(row, row['id'] == demo_request)
                assert row.get('matchedUserIsDemo') is (row['id'] == real_request)
        for identifier, expected in ((demo_request, True), (real_request, False)):
            status, row = api(client, base, 'GET', f'/api/requests/{identifier}')
            assert status == 200
            assert_marker(row, expected)
        status, comments = api(client, base, 'GET', f'/api/requests/{real_request}/comments')
        assert status == 200 and len(comments) == 2
        assert_marker(comments[0], True)
        assert comments[0].get('parentAuthorIsDemo') is False
        assert_marker(comments[1], False)
        assert comments[1].get('parentAuthorIsDemo') is True
        status, applications = api(client, base, 'GET', f'/api/requests/{real_request}/applications')
        assert status == 200 and len(applications) == 1
        assert_marker(applications[0], True)
        status, connections = api(client, base, 'GET', '/api/connections')
        assert status == 200 and len(connections) == 1
        assert_marker(connections[0], True)
        status, created = api(client, base, 'POST', '/api/requests', {
            'districtId': 1, 'title': '[Synthetic] Editable title',
            'description': 'Demo 782', 'role': 'mentee',
        })
        assert status == 201
        assert_marker(created, False)
        assert created.get('matchedUserIsDemo') is False
        status, updated = api(client, base, 'PATCH', f'/api/requests/{created["id"]}', {'title': 'Natural title'})
        assert status == 200
        assert_marker(updated, False)
        assert api(client, base, 'POST', '/api/blocks', {'blockedUserId': 501})[0] == 201
        status, blocked = api(client, base, 'GET', '/api/blocks')
        assert status == 200
        assert_marker(next(row for row in blocked if row['blockedUserId'] == 501), True)


def test_teaching_question_and_user_data_use_canonical_demo_markers(backend_database, monkeypatch):
    from get_questions import get_question_by_id, get_questions_for_student
    from get_users import get_user_by_id, get_all_users, get_all_mentors
    monkeypatch.setenv('DATABASE_URL', backend_database)
    seed_identities(backend_database)
    question_ids = execute(backend_database, """INSERT INTO questions(student_id,subject,message)
        VALUES (501,'Math','Natural question'),(1,'Math','[Synthetic] Real question')
        RETURNING id""")
    for (question_id,), expected in zip(question_ids, (True, False)):
        assert_marker(get_question_by_id(question_id), expected)
    assert_marker(get_questions_for_student(501)[0], True)
    assert_marker(get_user_by_id(501), True)
    assert_marker(get_user_by_id(1), False)
    for getter in (get_all_users, get_all_mentors):
        rows = getter()
        for row in rows:
            assert_marker(row, row['id'] == 501)
    assert get_question_by_id(999999) is None
    assert get_user_by_id(999999) is None


@pytest.mark.parametrize('password_hash', [
    '!mentor-connect-synthetic:', '!mentor-connect-synthetic:v1:unreviewed-batch', LOCK + ':extra',
])
def test_unknown_or_malformed_synthetic_locks_stay_locked_without_approved_demo_label(
        backend_database, backend_server, password_hash):
    execute(backend_database, 'UPDATE users SET password_hash=%s WHERE id=501', (password_hash,))
    with backend_server() as base:
        client, _ = login(base, 'student001@test.edu')
        status, profile = api(client, base, 'GET', '/api/users/501')
        assert status == 200
        assert_marker(profile, False)
        assert api(build_opener(), base, 'POST', '/api/auth/login', {
            'email': 'mentor501@test.edu', 'password': 'Password123!',
        })[0] == 401


def test_request_demo_marker_requires_both_approved_author_and_reserved_batch_key(backend_database, backend_server):
    seed_identities(backend_database)
    cases = [(501, None), (501, 'mc-synthetic-v1-983-782:question:0783'),
             (501, 'mc-synthetic-v1-983-782:question:0001:extra'),
             (1, 'mc-synthetic-v1-983-782:question:0001'),
             (501, 'mc-synthetic-v1-983-782:question:0782')]
    identifiers = []
    for author_id, key in cases:
        identifiers.append(execute(backend_database, """INSERT INTO requests
            (author_id,district_id,title,description,role,request)
            VALUES (%s,1,'Natural title','Natural content','mentee',%s) RETURNING id""", (author_id, key))[0][0])
    with backend_server() as base:
        client, _ = login(base, 'student001@test.edu')
        for index, identifier in enumerate(identifiers):
            status, row = api(client, base, 'GET', f'/api/requests/{identifier}')
            assert status == 200
            assert_marker(row, index == len(identifiers) - 1)
        assert api(client, base, 'POST', '/api/requests', {
            'districtId': 1, 'title': 'Natural title', 'description': 'Natural content',
            'role': 'mentee', 'isDemo': True,
        })[0] == 422
