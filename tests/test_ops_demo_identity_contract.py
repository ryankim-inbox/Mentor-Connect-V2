"""Operational views retain canonical demo labels without changing their results."""
import json

import pytest

from backend_support import api, login
from test_account_trust import execute
from test_demo_identity_contract import LOCK


@pytest.mark.parametrize('via_gateway', [False, True])
def test_operational_demo_labels_follow_canonical_rows_and_preserve_evidence(
        backend_database, backend_server, request, via_gateway):
    execute(backend_database, 'DELETE FROM blocks')
    execute(backend_database, 'UPDATE users SET is_admin=true WHERE id=1')
    execute(backend_database, "UPDATE users SET password_hash=%s,name='Maya Chen' WHERE id IN (501,951)", (LOCK,))
    execute(backend_database, "UPDATE users SET subjects=ARRAY['Math'],available_times=ARRAY['Mon 16:00'] WHERE id IN (501,502)")
    execute(backend_database, "UPDATE users SET name='[Synthetic] Real Mentor' WHERE id=502")
    question = execute(backend_database, "INSERT INTO questions(student_id,subject,topic) VALUES (951,'Math','Natural question') RETURNING id")[0][0]
    demo_request = execute(backend_database, """INSERT INTO requests(author_id,district_id,title,description,role,request)
        VALUES (951,1,'Natural title','Natural description','mentee','mc-synthetic-v1-983-782:question:0001') RETURNING id""")[0][0]
    report = execute(backend_database, """INSERT INTO reports
        (reporter_id,reported_user_id,reason,target_type,request_id,request_title,description)
        VALUES (1,951,'other','request',%s,'Preserved ordinary evidence','Original report text') RETURNING id""", (demo_request,))[0][0]
    execute(backend_database, "INSERT INTO reports(reporter_id,reported_user_id,reason) VALUES (501,502,'other')")
    with backend_server() as backend:
        base = request.getfixturevalue('gateway_server') if via_gateway else backend
        admin, _ = login(base, 'student001@test.edu')
        payloads = []
        for path in (f'/api/matches/{question}', f'/api/practice/matching/{question}'):
            status, result = api(admin, base, 'GET', path)
            assert status == 200 and result['success'] is True
            assert result.get('isDemo') is True
            assert result.get('studentIsDemo') is True
            assert [(row['mentor_id'], row['score'], row.get('isDemo')) for row in result['matches']] == [
                (501, 50, True), (502, 50, False)]
            payloads.append(result)
        status, scheduling = api(admin, base, 'GET', '/api/scheduling/suggest?user_a=501&user_b=502')
        assert status == 200 and scheduling['success'] is True
        assert scheduling['data']['userA'].get('isDemo') is True
        assert scheduling['data']['userB'].get('isDemo') is False
        assert scheduling['data']['overlap'] == ['Mon 16:00']
        payloads.append(scheduling)
        status, activity = api(admin, base, 'GET', '/api/analytics/mentor-response-rates')
        assert status == 200 and activity['success'] is True
        mentors = {row['mentorId']: row for row in activity['data']['mentors']}
        assert mentors[501].get('isDemo') is True
        assert mentors[502].get('isDemo') is False
        assert all(row['totalMatches'] == 0 and row['avgTimeToMatchHours'] is None for row in mentors.values())
        payloads.append(activity)
        status, flagged = api(admin, base, 'GET', '/api/admin/flagged-users')
        assert status == 200 and flagged['success'] is True
        assert {row['userId']: row.get('isDemo') for row in flagged['data']} == {951: True, 502: False}
        payloads.append(flagged)
        status, reports = api(admin, base, 'GET', '/api/admin/reports')
        assert status == 200
        contextual = next(row for row in reports if row['id'] == report)
        assert contextual.get('reporterIsDemo') is False
        assert contextual.get('reportedUserIsDemo') is True
        assert contextual.get('requestIsDemo') is True
        ordinary = next(row for row in reports if row['id'] != report)
        assert ordinary.get('reporterIsDemo') is True
        assert ordinary.get('reportedUserIsDemo') is False
        assert ordinary.get('requestIsDemo') is False
        payloads.append(reports)
        execute(backend_database, 'DELETE FROM requests WHERE id=%s', (demo_request,))
        status, retained = api(admin, base, 'PATCH', f'/api/admin/reports/{report}', {'status': 'reviewing'})
        assert status == 200
        assert retained['requestTitle'] == 'Preserved ordinary evidence'
        assert retained['description'] == 'Original report text'
        assert retained['requestId'] is None and retained.get('requestIsDemo') is False
        payloads.append(retained)
        serialized = json.dumps(payloads, default=str)
        assert 'password_hash' not in serialized and LOCK not in serialized
