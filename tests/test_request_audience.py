"""Audience privacy and acceptance alerts over disposable synthetic records."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from threading import Barrier
from urllib.request import build_opener
from uuid import uuid4

import psycopg2
import pytest
from pydantic import ValidationError

from backend_support import api, login
from test_account_trust import execute
from test_demo_admin_access import CONFIG


REQUEST = {'districtId': 1, 'title': 'Private study request',
           'description': 'Synthetic audience test', 'role': 'mentee', 'tagIds': [1]}


@pytest.fixture
def audience_database(backend_database):
    execute(backend_database, """UPDATE users SET gender=CASE
        WHEN id=501 THEN 'female' WHEN id IN (1,502,951) THEN 'male' END;
        DELETE FROM blocks;
        INSERT INTO users(id,email,name,password_hash,role,district_id,is_admin)
        SELECT 991,'admin@test.edu','Synthetic demo admin',password_hash,role,district_id,true
        FROM users WHERE id=951""")
    return backend_database


def publish(client, base, **changes):
    status, row = api(client, base, 'POST', '/api/requests', {**REQUEST, **changes})
    assert status == 201, row
    return row


def row_ids(client, base, path='/api/requests'):
    status, rows = api(client, base, 'GET', path)
    assert status == 200, rows
    return {row['id'] for row in rows}


@pytest.mark.parametrize('text', ['a', '한', '🦉'])
def test_title_codepoint_boundaries_preserve_spaces_and_unicode(text):
    from routers.requests import CreateRequestBody, UpdateRequestBody
    for length in (59, 60):
        title = ' ' + text * (length - 2) + ' '
        assert len(title) == length
        assert CreateRequestBody(**{**REQUEST, 'title': title}).title == title
        assert UpdateRequestBody(title=title).title == title
    for title in (text * 61, ' ' + text * 60, text * 60 + ' '):
        with pytest.raises(ValidationError):
            CreateRequestBody(**{**REQUEST, 'title': title})
        with pytest.raises(ValidationError):
            UpdateRequestBody(title=title)


@pytest.mark.parametrize('title', ['', ' \t\n', '\ufeff', '\x1c\u00a0\ufeff', '\ud800', 'a\udfff'])
def test_title_rejects_empty_shared_whitespace_and_surrogates(title):
    from routers.requests import CreateRequestBody, UpdateRequestBody
    with pytest.raises(ValidationError):
        CreateRequestBody(**{**REQUEST, 'title': title})
    with pytest.raises(ValidationError):
        UpdateRequestBody(title=title)


def test_title_combining_characters_are_separate_codepoints():
    from routers.requests import CreateRequestBody
    assert len(CreateRequestBody(**{**REQUEST, 'title': 'e\u0301' * 30}).title) == 60
    with pytest.raises(ValidationError):
        CreateRequestBody(**{**REQUEST, 'title': 'e\u0301' * 30 + 'e'})


def test_audience_list_detail_counts_and_public_metadata(audience_database, backend_server):
    with backend_server(environment=CONFIG) as base:
        owner, _ = login(base, 'student001@test.edu')
        female, _ = login(base, 'mentor501@test.edu')
        male, _ = login(base, 'both951@test.edu')
        unknown, _ = login(base, 'aiko.yoon.0002@test.edu')
        admin, _ = login(base, 'admin@test.edu')
        posts = {audience: publish(owner, base, audience=audience) for audience in ('female', 'male', 'both')}
        assert len({post['id'] for post in posts.values()}) == 3
        for client, visible in [(owner, set(posts)), (female, {'female', 'both'}),
                                (male, {'male', 'both'}), (unknown, {'both'}), (admin, set(posts))]:
            expected = {posts[key]['id'] for key in visible}
            assert row_ids(client, base) == expected
            assert row_ids(client, base, '/api/requests?districtId=1&tagId=1&role=mentee&limit=50') == expected
            for audience, post in posts.items():
                status, detail = api(client, base, 'GET', f"/api/requests/{post['id']}")
                assert status == (200 if audience in visible else 404), detail
            status, tags = api(client, base, 'GET', '/api/tags')
            assert status == 200 and tags[0]['requestCount'] == len(expected)
            status, district = api(client, base, 'GET', '/api/districts/1')
            assert status == 200 and district['openRequestCount'] == len(expected)
            status, districts = api(client, base, 'GET', '/api/districts?search=Fremont')
            assert status == 200 and districts[0]['openRequestCount'] == len(expected)
        status, public_districts = api(build_opener(), base, 'GET', '/api/districts?search=Fremont')
        assert status == 200 and public_districts[0]['openRequestCount'] == 1
        path = f"/api/requests/{posts['female']['id']}"
        assert api(owner, base, 'PATCH', path, {'audience': 'both'})[0] == 422
        assert api(owner, base, 'GET', path)[1]['audience'] == 'female'
        assert publish(owner, base, title='Legacy client has no audience')['audience'] == 'both'
        assert api(unknown, base, 'POST', '/api/requests', {**REQUEST, 'audience': 'unknown'})[0] == 422
        assert api(admin, base, 'POST', '/api/requests', REQUEST)[0] == 403


def test_private_request_interactions_fail_closed_and_admin_can_moderate(audience_database, backend_server):
    with backend_server(environment=CONFIG) as base:
        owner, _ = login(base, 'student001@test.edu')
        female, _ = login(base, 'mentor501@test.edu')
        male, _ = login(base, 'both951@test.edu')
        unknown, _ = login(base, 'aiko.yoon.0002@test.edu')
        admin, _ = login(base, 'admin@test.edu')
        post = publish(owner, base, audience='female')
        path = f"/api/requests/{post['id']}"
        comment_body = {'body': 'Only eligible viewers can read this', 'clientCommentId': str(uuid4())}
        status, comment = api(female, base, 'POST', path + '/comments', comment_body)
        assert status == 201
        status, application = api(female, base, 'POST', path + '/applications')
        assert status == 200
        endpoints = [('GET', '', None), ('PATCH', '', {'title': 'Cannot edit'}), ('DELETE', '', None),
                     ('GET', '/comments', None), ('POST', '/comments', comment_body),
                     ('PATCH', f"/comments/{comment['id']}", {'body': 'Cannot edit'}),
                     ('DELETE', f"/comments/{comment['id']}", None),
                     ('GET', '/applications', None), ('POST', '/applications', None), ('POST', '/match', None),
                     ('PATCH', f"/applications/{application['id']}", {'action': 'cancel'})]
        for client in (male, unknown):
            for method, suffix, body in endpoints:
                assert api(client, base, method, path + suffix, body)[0] == 404, (method, suffix)
            assert api(client, base, 'POST', '/api/reports', {
                'reportedUserId': 1, 'requestId': post['id'], 'reason': 'other'})[0] == 404
        assert api(admin, base, 'GET', path + '/comments')[1][0]['body'] == comment_body['body']
        assert api(admin, base, 'DELETE', path + f"/comments/{comment['id']}")[0] == 200
        for method, suffix, body in [('POST', '/applications', None), ('POST', '/comments', comment_body),
                                     ('PATCH', '', {'title': 'Administrator cannot edit'})]:
            assert api(admin, base, method, path + suffix, body)[0] == 403
        assert api(admin, base, 'GET', '/api/notifications')[0] == 403
        assert api(admin, base, 'DELETE', path)[0] == 204


def test_current_gender_revokes_activity_comments_acceptance_and_notifications(audience_database, backend_server):
    with backend_server() as base:
        owner, _ = login(base, 'student001@test.edu')
        female, _ = login(base, 'mentor501@test.edu')
        post = publish(owner, base, audience='female')
        path = f"/api/requests/{post['id']}"
        app = api(female, base, 'POST', path + '/applications')[1]
        comment = api(female, base, 'POST', path + '/comments', {'body': 'Before change', 'clientCommentId': str(uuid4())})[1]
        assert api(female, base, 'GET', '/api/notifications')[1]['unreadCount'] == 1
        execute(audience_database, "UPDATE users SET gender=NULL WHERE id=501")
        assert api(female, base, 'GET', '/api/notifications')[1] == {'unreadCount': 0, 'items': []}
        assert api(female, base, 'POST', '/api/notifications/read')[0] == 204
        assert execute(audience_database, 'SELECT read_at FROM notifications WHERE user_id=501') == [(None,)]
        assert row_ids(female, base, '/api/request-activity') == set()
        assert api(female, base, 'PATCH', path + f"/comments/{comment['id']}", {'body': 'After change'})[0] == 404
        assert api(owner, base, 'PATCH', path + f"/applications/{app['id']}", {'action': 'accept'})[0] == 404
        assert api(owner, base, 'GET', path)[1]['status'] == 'open'
        execute(audience_database, "UPDATE users SET gender='female' WHERE id=501")
        assert api(owner, base, 'PATCH', path + f"/applications/{app['id']}", {'action': 'accept'})[0] == 200
        assert api(female, base, 'GET', '/api/connections')[1][0]['requestId'] == post['id']
        assert api(female, base, 'GET', '/api/users/1/activity-rank')[1]['distinctPartners'] == 1
        execute(audience_database, "UPDATE users SET gender='male' WHERE id=501")
        assert api(female, base, 'GET', '/api/connections')[1] == []
        assert row_ids(female, base, '/api/request-activity') == set()
        assert api(female, base, 'GET', '/api/users/1/activity-rank')[1]['distinctPartners'] == 0
        assert api(owner, base, 'GET', '/api/users/1/activity-rank')[1]['distinctPartners'] == 1
        assert api(female, base, 'GET', '/api/notifications')[1]['items'] == []


def test_eligible_mentor_alerts_are_top_five_and_author_gets_one_summary(audience_database, backend_server):
    execute(audience_database, """INSERT INTO users(id,email,name,password_hash,role,district_id,gender)
        SELECT n,'audience'||n||'@test.edu','Synthetic eligible mentor '||n,password_hash,'mentor',1,'female'
        FROM users CROSS JOIN generate_series(1001,1007) n WHERE id=501""")
    with backend_server() as base:
        owner, _ = login(base, 'student001@test.edu')
        post = publish(owner, base, audience='female')
        assert publish(owner, base, audience='female')['id'] == post['id']
        assert execute(audience_database, """SELECT u.gender,count(*) FROM notifications n JOIN users u ON u.id=n.user_id
            WHERE request_id=%s AND kind='request_match' GROUP BY u.gender""", (post['id'],)) == [('female', 5)]
        summary = api(owner, base, 'GET', '/api/notifications')[1]['items']
        assert len(summary) == 1 and summary[0]['kind'] == 'request_match_summary'
        assert '5 mentors' in summary[0]['message']
        assert execute(audience_database, 'SELECT count(*) FROM request_applications') == [(0,)]
        assert execute(audience_database, "SELECT status,matched_user_id FROM requests WHERE id=%s", (post['id'],)) == [('open', None)]


def test_delivery_rechecks_audience_after_candidate_selection(audience_database, monkeypatch):
    import auto_match
    import db
    monkeypatch.setattr(db, 'DATABASE_URL', audience_database)
    request_id = execute(audience_database, """INSERT INTO requests(author_id,district_id,title,description,role,audience)
        VALUES (1,1,'Recheck candidate','Synthetic','mentee','female') RETURNING id""")[0][0]
    find = auto_match.find_matches_for_request
    def candidate_gender_changes(cur, request_row):
        matches = find(cur, request_row)
        assert [match['mentor_id'] for match in matches] == [501]
        execute(audience_database, "UPDATE users SET gender='male' WHERE id=501")
        return matches
    monkeypatch.setattr(auto_match, 'find_matches_for_request', candidate_gender_changes)
    assert auto_match.auto_match_request({'id': request_id}) == 0
    assert execute(audience_database, "SELECT user_id,kind FROM notifications WHERE request_id=%s", (request_id,)) == [(1, 'request_match_summary')]


def test_acceptance_notifies_both_once_with_concurrent_retry_and_rematch(audience_database, backend_server):
    execute(audience_database, "UPDATE users SET gender='female' WHERE id=951")
    with backend_server() as base:
        owner, _ = login(base, 'student001@test.edu')
        owner_retry, _ = login(base, 'student001@test.edu')
        female, _ = login(base, 'mentor501@test.edu')
        next_female, _ = login(base, 'both951@test.edu')
        post = publish(owner, base, audience='female')
        path = f"/api/requests/{post['id']}"
        app = api(female, base, 'POST', path + '/applications')[1]
        action = path + f"/applications/{app['id']}"
        barrier = Barrier(2)
        def accept(client):
            barrier.wait(timeout=5)
            return api(client, base, 'PATCH', action, {'action': 'accept'})[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert list(pool.map(accept, [owner, owner_retry])) == [200, 200]
        assert execute(audience_database, "SELECT user_id,count(*) FROM notifications WHERE kind='request_accepted' GROUP BY user_id ORDER BY user_id") == [(1, 1), (501, 1)]
        assert api(owner, base, 'PATCH', path, {'status': 'open'})[0] == 200
        next_app = api(next_female, base, 'POST', path + '/applications')[1]
        assert next_app['id'] != app['id']
        assert api(owner, base, 'PATCH', path + f"/applications/{next_app['id']}", {'action': 'accept'})[0] == 200
        assert execute(audience_database, "SELECT user_id,count(*) FROM notifications WHERE kind='request_accepted' GROUP BY user_id ORDER BY user_id") == [(1, 2), (501, 1), (951, 1)]
        for client in (owner, female, next_female):
            accepted = [item for item in api(client, base, 'GET', '/api/notifications')[1]['items'] if item['kind'] == 'request_accepted']
            assert accepted and all(item['requestId'] == post['id'] for item in accepted)


def test_notifications_read_snapshot_keeps_new_arrivals_unread(audience_database, backend_server):
    with backend_server() as base:
        owner, _ = login(base, 'student001@test.edu')
        female, _ = login(base, 'mentor501@test.edu')
        publish(owner, base, title='First snapshot request', audience='female')
        first = api(female, base, 'GET', '/api/notifications')[1]['items'][0]
        publish(owner, base, title='Unseen new arrival', audience='female')
        assert api(female, base, 'POST', '/api/notifications/read', {'ids': [first['id']]})[0] == 204
        first_read_at = execute(audience_database, 'SELECT read_at FROM notifications WHERE id=%s', (first['id'],))[0][0]
        inbox = api(female, base, 'GET', '/api/notifications')[1]
        assert inbox['unreadCount'] == 1 and inbox['items'][0]['read'] is False
        assert inbox['items'][1]['read'] is True
        assert api(female, base, 'POST', '/api/notifications/read', {'ids': [first['id']]})[0] == 204
        assert execute(audience_database, 'SELECT read_at FROM notifications WHERE id=%s', (first['id'],))[0][0] == first_read_at
        for body in ({'ids': [0]}, {'ids': [True]}, {'ids': ['1']}, {'ids': []},
                     {'ids': [first['id'], first['id']]}, {'ids': list(range(1, 52))},
                     {'ids': first['id']}, {'ids': [first['id']], 'userId': 1},
                     {'throughId': first['id']}):
            assert api(female, base, 'POST', '/api/notifications/read', body)[0] == 422
        assert api(female, base, 'POST', '/api/notifications/read')[0] == 204
        assert api(female, base, 'GET', '/api/notifications')[1]['unreadCount'] == 0


def test_publication_audience_changes_are_distinct_and_old_hashes_still_replay(audience_database, backend_server):
    import hashlib
    import json
    old_payload = {**REQUEST, 'preferredTimes': []}
    old_digest = hashlib.sha256(json.dumps(old_payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    with backend_server() as base:
        owner, _ = login(base, 'student001@test.edu')
        key = str(uuid4())
        original = publish(owner, base, clientRequestId=key)
        assert execute(audience_database, 'SELECT payload_hash FROM requests WHERE id=%s', (original['id'],)) == [(old_digest,)]
        assert publish(owner, base, clientRequestId=key, audience='both')['id'] == original['id']
        assert api(owner, base, 'POST', '/api/requests', {**REQUEST, 'clientRequestId': key, 'audience': 'female'})[0] == 409
        restricted = publish(owner, base, audience='female')
        assert restricted['id'] != original['id']
        assert publish(owner, base, audience='female')['id'] == restricted['id']


def test_title_boundaries_over_real_http(audience_database, backend_server):
    with backend_server() as base:
        owner, _ = login(base, 'student001@test.edu')
        row = publish(owner, base, title=' ' + '🦉' * 58 + ' ')
        path = f"/api/requests/{row['id']}"
        assert row['title'] == ' ' + '🦉' * 58 + ' '
        assert api(owner, base, 'GET', '/api/requests')[1][0]['title'] == row['title']
        for title in ('🦉' * 59, '🦉' * 60, 'e\u0301' * 30):
            assert api(owner, base, 'PATCH', path, {'title': title})[0] == 200
        for title in ('🦉' * 61, ' ' + 'a' * 60, '\ufeff', '\x1c\ufeff', '\ud800', 'a\udfff'):
            assert api(owner, base, 'POST', '/api/requests', {**REQUEST, 'title': title})[0] == 422
            assert api(owner, base, 'PATCH', path, {'title': title})[0] == 422



def test_observed_notification_ids_leave_late_lower_id_commit_unread(audience_database, backend_server):
    with backend_server() as base:
        owner, _ = login(base, 'student001@test.edu')
        female, _ = login(base, 'mentor501@test.edu')
        post = publish(owner, base, audience='female')
        # Allocate a lower sequence ID in an uncommitted transaction. PostgreSQL
        # sequence order does not imply commit order or what the inbox displayed.
        with closing(psycopg2.connect(audience_database)) as delayed, delayed.cursor() as cur:
            cur.execute("""INSERT INTO notifications(user_id,kind,request_id,message,event_key)
                VALUES (501,'request_accepted',%s,'Late committed alert','test:late') RETURNING id""", (post['id'],))
            late_id = cur.fetchone()[0]
            publish(owner, base, title='Visible newer ID', audience='female')
            inbox = api(female, base, 'GET', '/api/notifications')[1]
            observed_ids = [item['id'] for item in inbox['items'] if not item['read']]
            assert late_id not in observed_ids and late_id < max(observed_ids)
            delayed.commit()
        assert api(female, base, 'POST', '/api/notifications/read', {'ids': observed_ids})[0] == 204
        assert execute(audience_database, 'SELECT read_at FROM notifications WHERE id=%s', (late_id,)) == [(None,)]
        first_read_times = execute(audience_database, 'SELECT id,read_at FROM notifications WHERE id=ANY(%s) ORDER BY id', (observed_ids,))
        publish(owner, base, title='Arrived after acknowledgment', audience='female')
        assert api(female, base, 'POST', '/api/notifications/read', {'ids': observed_ids})[0] == 204
        assert execute(audience_database, 'SELECT id,read_at FROM notifications WHERE id=ANY(%s) ORDER BY id', (observed_ids,)) == first_read_times
        assert execute(audience_database, 'SELECT read_at FROM notifications WHERE id=%s', (late_id,)) == [(None,)]
        inbox = api(female, base, 'GET', '/api/notifications')[1]
        assert inbox['unreadCount'] == 2
        assert late_id in [item['id'] for item in inbox['items'] if not item['read']]


def test_notification_ids_cannot_acknowledge_other_users_or_inaccessible_posts(audience_database, backend_server):
    with backend_server() as base:
        owner, _ = login(base, 'student001@test.edu')
        female, _ = login(base, 'mentor501@test.edu')
        post = publish(owner, base, audience='female')
        own_id = api(female, base, 'GET', '/api/notifications')[1]['items'][0]['id']
        other_id = api(owner, base, 'GET', '/api/notifications')[1]['items'][0]['id']
        # This simulates an old notification after the recipient lost access.
        execute(audience_database, "UPDATE users SET gender='male' WHERE id=501")
        assert api(female, base, 'POST', '/api/notifications/read', {'ids': [own_id, other_id]})[0] == 204
        assert execute(audience_database, 'SELECT read_at FROM notifications WHERE id=ANY(%s)', ([own_id, other_id],)) == [(None,), (None,)]
        assert api(female, base, 'GET', '/api/notifications')[1] == {'unreadCount': 0, 'items': []}
        assert api(female, base, 'POST', '/api/notifications/read')[0] == 204
        assert execute(audience_database, 'SELECT read_at FROM notifications WHERE id=ANY(%s)', ([own_id, other_id],)) == [(None,), (None,)]
