"""Account trust contracts composed through the real gateway and disposable DB."""
import json
from datetime import datetime
from uuid import uuid4
from urllib.request import build_opener

import pytest
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect

from backend_support import api, login
from test_account_trust import execute, token_from, unverify


def test_gateway_verification_flow_and_current_authority(request, backend_database, monkeypatch, tmp_path):
    unverify(backend_database)
    monkeypatch.setenv('EMAIL_DELIVERY_MODE', 'development-file')
    monkeypatch.setenv('EMAIL_DEV_OUTBOX_DIR', str(tmp_path / 'outbox'))
    monkeypatch.setenv('APP_ORIGIN', 'http://127.0.0.1:14200')
    base = request.getfixturevalue('gateway_server')
    student, _ = login(base, 'student001@test.edu')
    status, own = api(student, base, 'GET', '/api/users/1')
    assert status == 200 and own['isVerified'] is False and own['isAdmin'] is False
    assert api(student, base, 'PATCH', '/api/users/1', {'bio': 'Own settings'})[0] == 200
    for path in ['/api/mentors', '/api/users/501', '/api/tags', '/api/districts/1', '/api/stats/district/1']:
        assert api(student, base, 'GET', path)[0] == 403, path
    status, result = api(student, base, 'POST', '/api/auth/verification/request')
    assert status == 202 and 'token' not in json.dumps(result)
    token = token_from(tmp_path / 'outbox')
    assert api(student, base, 'POST', '/api/auth/verification/request')[0] == 429
    status, own = api(student, base, 'POST', '/api/auth/verification/confirm', {'token': token})
    assert status == 200 and own['isVerified'] is True and own['isAdmin'] is False
    assert token not in json.dumps(own)
    assert api(student, base, 'POST', '/api/auth/verification/confirm', {'token': token})[0] == 400
    status, mentors = api(student, base, 'GET', '/api/mentors?limit=50')
    assert status == 200 and [m['id'] for m in mentors] == [501]
    assert set(mentors[0]) == {'id', 'name', 'role', 'subjects', 'districtId', 'districtName', 'bio'}
    assert set(api(student, base, 'GET', '/api/users/501')[1]) == {'id', 'name', 'subjects', 'createdAt'}
    unverify(backend_database)
    assert api(student, base, 'GET', '/api/mentors')[0] == 403


def test_gateway_report_moderation_and_admin_revocation(gateway_server, backend_database):
    base = gateway_server
    student, _ = login(base, 'student001@test.edu')
    assert api(student, base, 'POST', '/api/reports', {'reportedUserId': 501, 'reason': 'other', 'description': 'Private report'})[0] == 201
    assert api(student, base, 'GET', '/api/admin/reports')[0] == 403
    execute(backend_database, 'UPDATE users SET is_admin=true WHERE id=501')
    admin, _ = login(base, 'mentor501@test.edu')
    status, reports = api(admin, base, 'GET', '/api/admin/reports?status=open&limit=50')
    assert status == 200 and reports[0]['description'] == 'Private report'
    path = f"/api/admin/reports/{reports[0]['id']}"
    status, report = api(admin, base, 'PATCH', path, {'status': 'reviewing', 'note': 'Internal'})
    assert status == 200 and report['reviewedBy'] == 501 and report['reviewedAt'] and report['note'] == 'Internal'
    assert api(admin, base, 'PATCH', path, {'status': 'resolved', 'reviewedBy': 1}) == (422, {'error': 'invalid_input'})
    execute(backend_database, 'UPDATE users SET is_admin=false WHERE id=501')
    assert api(admin, base, 'GET', '/api/admin/reports')[0] == 403


@pytest.mark.parametrize(('note_patch', 'expected_note'), [
    ({}, 'Retain this synthetic moderation rationale'),
    ({'note': None}, None),
    ({'note': 'Replacement rationale'}, 'Replacement rationale'),
], ids=['omitted-preserves', 'null-clears', 'string-replaces'])
def test_gateway_moderation_note_patch_semantics_persist_with_audit(
        gateway_server, backend_database, note_patch, expected_note):
    base = gateway_server
    student, _ = login(base, 'student001@test.edu')
    assert api(student, base, 'POST', '/api/reports', {
        'reportedUserId': 501, 'reason': 'other', 'description': 'Synthetic moderation evidence',
    })[0] == 201
    execute(backend_database, 'UPDATE users SET is_admin=true WHERE id=501')
    admin, _ = login(base, 'mentor501@test.edu')
    report_id = api(admin, base, 'GET', '/api/admin/reports')[1][0]['id']
    path = f'/api/admin/reports/{report_id}'
    status, report = api(admin, base, 'PATCH', path, {
        'status': 'reviewing', 'note': 'Retain this synthetic moderation rationale',
    })
    assert status == 200 and report['note'] == 'Retain this synthetic moderation rationale'
    # Every moderation operation must refresh its actor/time, including status-only saves.
    execute(backend_database,
            "UPDATE reports SET reviewed_by=1,reviewed_at='2000-01-01T00:00:00Z' WHERE id=%s",
            (report_id,))
    status, report = api(admin, base, 'PATCH', path, {'status': 'resolved', **note_patch})
    assert status == 200
    stored = execute(backend_database,
                     'SELECT status,note,reviewed_by,reviewed_at FROM reports WHERE id=%s',
                     (report_id,))[0]
    assert report['note'] == expected_note
    assert stored[:3] == ('resolved', expected_note, 501)
    assert report['status'] == 'resolved' and report['reviewedBy'] == 501
    assert datetime.fromisoformat(report['reviewedAt']) == stored[3]
    assert stored[3].year > 2000
    assert api(admin, base, 'GET', '/api/admin/reports')[1][0] == report
    assert api(student, base, 'GET', '/api/admin/reports')[0] == 403


def test_gateway_comment_edit_delete_tombstone_and_replay(gateway_server):
    base = gateway_server
    owner, _ = login(base, 'student001@test.edu')
    mentor, _ = login(base, 'mentor501@test.edu')
    status, row = api(owner, base, 'POST', '/api/requests', {'districtId': 1, 'title': 'E2E TEST gateway trust', 'description': 'Contract only', 'role': 'mentee'})
    assert status == 201
    path = f"/api/requests/{row['id']}/comments"
    client_id = str(uuid4())
    status, parent = api(owner, base, 'POST', path, {'body': 'Deleted text canary', 'clientCommentId': client_id})
    assert status == 201
    assert parent['updatedAt'] is None and parent['deletedAt'] is None
    status, reply = api(mentor, base, 'POST', path, {'body': 'Preserved reply', 'parentId': parent['id'], 'clientCommentId': str(uuid4())})
    assert status == 201
    comment_path = path + f"/{parent['id']}"
    assert api(mentor, base, 'PATCH', comment_path, {'body': 'Forged edit'})[0] == 403
    status, edited = api(owner, base, 'PATCH', comment_path, {'body': 'Edited canary'})
    assert status == 200 and edited['body'] == 'Edited canary' and edited['updatedAt']
    status, deleted = api(owner, base, 'DELETE', comment_path)
    assert status == 200 and deleted['body'] == '' and deleted['deletedAt']
    assert api(owner, base, 'DELETE', comment_path)[1] == deleted
    assert api(owner, base, 'PATCH', comment_path, {'body': 'Restore'})[0] == 409
    assert api(owner, base, 'POST', path, {'body': 'Deleted text canary', 'clientCommentId': client_id})[1] == deleted
    status, comments = api(owner, base, 'GET', path)
    assert status == 200 and any(c['id'] == reply['id'] and c['body'] == 'Preserved reply' for c in comments)
    assert 'canary' not in json.dumps(comments)


@pytest.mark.parametrize('path', ['/ws/chat/rooms/1', '/ws/dms/1'])
def test_gateway_websocket_handshake_denies_revoked_ownership(gateway_server, backend_database, path):
    _, cookie = login(gateway_server, 'student001@test.edu')
    unverify(backend_database)
    with pytest.raises(InvalidStatus) as error:
        with connect(gateway_server.replace('http://', 'ws://') + path,
                     origin='http://127.0.0.1:14200', additional_headers={'Cookie': cookie}, open_timeout=3):
            pytest.fail('Revoked ownership accepted at gateway handshake')
    assert error.value.response.status_code == 403


def test_gateway_character_limits_match_python_at_astral_boundary(gateway_server, backend_database):
    base = gateway_server
    owner, _ = login(base, 'student001@test.edu')
    status, row = api(owner, base, 'POST', '/api/requests', {
        'districtId': 1, 'title': 'E2E TEST Unicode boundaries', 'description': 'Contract only', 'role': 'mentee',
    })
    assert status == 201
    path = f"/api/requests/{row['id']}/comments"
    at_limit, beyond_limit = '\U00010400' * 2000, '\U00010400' * 2001
    status, comment = api(owner, base, 'POST', path, {'body': at_limit, 'clientCommentId': str(uuid4())})
    assert status == 201 and comment['body'] == at_limit
    comment_path = path + f"/{comment['id']}"
    assert api(owner, base, 'PATCH', comment_path, {'body': '\U0001f600' * 2000})[0] == 200
    assert api(owner, base, 'PATCH', comment_path, {'body': beyond_limit})[0] == 422
    assert api(owner, base, 'POST', path, {'body': beyond_limit, 'clientCommentId': str(uuid4())})[0] == 422
    assert api(owner, base, 'GET', path)[1][0]['body'] == '\U0001f600' * 2000
    assert api(owner, base, 'POST', '/api/reports', {'reportedUserId': 501, 'reason': 'other', 'description': at_limit})[0] == 201
    assert api(owner, base, 'POST', '/api/reports', {'reportedUserId': 501, 'reason': 'other', 'description': beyond_limit})[0] == 422
    execute(backend_database, 'UPDATE users SET is_admin=true WHERE id=501')
    admin, _ = login(base, 'mentor501@test.edu')
    status, reports = api(admin, base, 'GET', '/api/admin/reports')
    assert status == 200 and reports[0]['description'] == at_limit
    report_path = f"/api/admin/reports/{reports[0]['id']}"
    status, report = api(admin, base, 'PATCH', report_path, {'status': 'reviewing', 'note': at_limit})
    assert status == 200 and report['description'] == at_limit and report['note'] == at_limit
    assert api(admin, base, 'PATCH', report_path, {'status': 'resolved', 'note': beyond_limit})[0] == 422


def test_gateway_preserves_legacy_report_evidence_after_moderation(gateway_server, backend_database):
    base = gateway_server
    evidence = 'a' * 4001 + '\U0001f600' * 3001
    report_id = execute(backend_database,
                        "INSERT INTO reports (reporter_id,reported_user_id,reason,description) VALUES (1,501,'other',%s) RETURNING id",
                        (evidence,))[0][0]
    student, _ = login(base, 'student001@test.edu')
    assert api(student, base, 'GET', '/api/admin/reports')[0] == 403
    execute(backend_database, 'UPDATE users SET is_admin=true WHERE id=501')
    admin, _ = login(base, 'mentor501@test.edu')
    status, reports = api(admin, base, 'GET', '/api/admin/reports?limit=50')
    assert status == 200 and reports[0]['description'] == evidence
    status, report = api(admin, base, 'PATCH', f'/api/admin/reports/{report_id}', {'status': 'resolved', 'note': '\U0001f600' * 2000})
    assert status == 200 and report['description'] == evidence and report['status'] == 'resolved'
    assert report['reviewedBy'] == 501 and report['reviewedAt']
    assert execute(backend_database, 'SELECT description FROM reports WHERE id=%s', (report_id,)) == [(evidence,)]
    assert api(student, base, 'GET', '/api/admin/reports')[0] == 403
