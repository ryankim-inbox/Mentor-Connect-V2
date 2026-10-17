"""Request publication identity, concurrency and post-commit notification effects."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Barrier
from uuid import uuid4

import psycopg2
import psycopg2.extras
import pytest
from fastapi import Request

from backend_support import api, login
from test_account_trust import execute


@pytest.fixture(autouse=True)
def replay_tags(backend_database):
    execute(backend_database, "INSERT INTO tags(id,name,color) VALUES (2,'Science','#246824')")


def payload(**changes):
    return {
        'districtId': 1, 'title': 'Replay-safe study question',
        'description': 'Synthetic request for publication tests',
        'role': 'mentee', 'tagIds': [1, 2],
        'preferredTimes': ['Mon 16:00', 'Tue 17:00'],
        **changes,
    }


def publish(client, base, body):
    status, result = api(client, base, 'POST', '/api/requests', body)
    assert status == 201, result
    return result


def test_same_key_replays_current_representation_without_duplicate_alerts(backend_database, backend_server):
    body = payload(clientRequestId=str(uuid4()))
    with backend_server() as base:
        student, _ = login(base, 'student001@test.edu')
        original = publish(student, base, body)
        notice_count = execute(backend_database, 'SELECT count(*) FROM notifications WHERE request_id=%s', (original['id'],))[0][0]
        assert notice_count > 0
        assert api(student, base, 'PATCH', f"/api/requests/{original['id']}", {'title': 'Edited after publication'})[0] == 200
        # The original publication digest survives later content edits and age.
        execute(backend_database, "UPDATE requests SET created_at=now()-interval '1 day' WHERE id=%s", (original['id'],))
        replayed = publish(student, base, body)
        assert replayed['id'] == original['id']
        assert replayed['title'] == 'Edited after publication'
        assert execute(backend_database, 'SELECT count(*) FROM notifications WHERE request_id=%s', (original['id'],))[0][0] == notice_count
        assert api(student, base, 'POST', '/api/requests', {**body, 'title': 'Changed publication'})[0] == 409


@pytest.mark.parametrize('keys', ['missing', 'different'])
def test_identical_content_coalesces_old_clients_and_different_keys(backend_database, backend_server, keys):
    first = payload(**({'clientRequestId': str(uuid4())} if keys == 'different' else {}))
    second = {**first, 'title': '  Replay-safe study question  ',
              'description': ' Synthetic request for publication tests ',
              'tagIds': [2, 1], 'preferredTimes': ['Tue 17:00', 'Mon 16:00']}
    if keys == 'different':
        second['clientRequestId'] = str(uuid4())
    with backend_server() as base:
        student, _ = login(base, 'student001@test.edu')
        a = publish(student, base, first)
        b = publish(student, base, second)
        assert a['id'] == b['id']
        assert execute(backend_database, 'SELECT count(*) FROM requests WHERE title=%s', (first['title'],))[0][0] == 1
        if keys == 'different':
            # Every acknowledged client key is bound, including a coalesced alias.
            assert api(student, base, 'POST', '/api/requests', {**second, 'description': 'Different payload'})[0] == 409


def test_content_window_expires_but_keys_are_scoped_to_each_author(backend_database, backend_server):
    key = str(uuid4())
    with backend_server() as base:
        student, _ = login(base, 'student001@test.edu')
        mentor, _ = login(base, 'mentor501@test.edu')
        original = publish(student, base, payload(clientRequestId=key))
        other = publish(mentor, base, payload(clientRequestId=key))
        assert other['id'] != original['id']
        execute(backend_database, "UPDATE requests SET created_at=now()-interval '6 minutes' WHERE id=%s", (original['id'],))
        later = publish(student, base, payload(clientRequestId=str(uuid4())))
        assert later['id'] != original['id']
        assert publish(student, base, payload(clientRequestId=key))['id'] == original['id']


def test_deleted_request_releases_all_submission_keys_and_alerts(backend_database, backend_server):
    first_key, alias_key = str(uuid4()), str(uuid4())
    with backend_server() as base:
        student, _ = login(base, 'student001@test.edu')
        original = publish(student, base, payload(clientRequestId=first_key))
        assert publish(student, base, payload(clientRequestId=alias_key))['id'] == original['id']
        assert api(student, base, 'DELETE', f"/api/requests/{original['id']}")[0] == 204
        assert execute(backend_database, 'SELECT count(*) FROM request_submission_keys WHERE request_id=%s', (original['id'],))[0][0] == 0
        assert execute(backend_database, 'SELECT count(*) FROM notifications WHERE request_id=%s', (original['id'],))[0][0] == 0
        replacement = publish(student, base, payload(clientRequestId=alias_key, title='Deliberate replacement'))
        assert replacement['id'] != original['id']


@pytest.mark.parametrize('change', [
    {'title': 'Another question'}, {'description': 'Another description'},
    {'districtId': 2}, {'role': 'mentor'}, {'tagIds': [1]},
    {'preferredTimes': ['Wed 18:00']},
])
def test_each_semantic_payload_change_is_a_new_publication_and_conflicts_with_same_key(backend_server, change):
    body = payload(clientRequestId=str(uuid4()))
    with backend_server() as base:
        student, _ = login(base, 'student001@test.edu')
        original = publish(student, base, body)
        assert api(student, base, 'POST', '/api/requests', {**body, **change})[0] == 409
        changed = publish(student, base, {**body, **change, 'clientRequestId': str(uuid4())})
        assert changed['id'] != original['id']


@pytest.mark.parametrize('key', ['invalid-key', '', 42, ['not-a-uuid']])
def test_bad_client_keys_do_not_create_rows(backend_database, backend_server, key):
    before = execute(backend_database, 'SELECT count(*) FROM requests')[0][0]
    with backend_server() as base:
        student, _ = login(base, 'student001@test.edu')
        assert api(student, base, 'POST', '/api/requests', payload(clientRequestId=key))[0] == 422
    assert execute(backend_database, 'SELECT count(*) FROM requests')[0][0] == before


@pytest.mark.parametrize('same_key', [True, False])
def test_concurrent_publish_creates_one_request_and_one_delivery_batch(backend_database, backend_server, same_key):
    key = str(uuid4())
    with backend_server() as base:
        clients = [login(base, 'student001@test.edu')[0] for _ in range(4)]
        ready = Barrier(len(clients))

        def send(client):
            ready.wait(timeout=5)
            return publish(client, base, payload(clientRequestId=key if same_key else str(uuid4())))

        with ThreadPoolExecutor(max_workers=len(clients)) as pool:
            requests = list(pool.map(send, clients))
        assert len({item['id'] for item in requests}) == 1
        request_id = requests[0]['id']
        groups = execute(backend_database, 'SELECT user_id,kind,count(*) FROM notifications WHERE request_id=%s GROUP BY user_id,kind', (request_id,))
        assert groups and all(count == 1 for _, _, count in groups)
        assert len([row for row in groups if row[1] == 'request_match_summary']) == 1
        assert len([row for row in groups if row[1] == 'request_match']) <= 5


def test_concurrent_same_key_conflict_has_one_winner(backend_database, backend_server):
    key = str(uuid4())
    with backend_server() as base:
        clients = [login(base, 'student001@test.edu')[0] for _ in range(2)]
        ready = Barrier(2)

        def send(index):
            ready.wait(timeout=5)
            return api(clients[index], base, 'POST', '/api/requests',
                       payload(clientRequestId=key, title=f'Concurrent question {index}'))

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(send, range(2)))
        assert sorted(status for status, _ in results) == [201, 409]
        assert execute(backend_database, 'SELECT count(*) FROM request_submission_keys WHERE client_request_id=%s', (key,))[0][0] == 1
        assert execute(backend_database, 'SELECT count(*) FROM requests WHERE client_request_id=%s', (key,))[0][0] == 1


def test_retry_repairs_failed_notification_transaction_without_republishing(backend_database, backend_server):
    execute(backend_database, """CREATE FUNCTION fail_demo_notification() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Synthetic local notification failure'; END $$;
        CREATE TRIGGER demo_notification_failure BEFORE INSERT ON notifications
        FOR EACH ROW EXECUTE FUNCTION fail_demo_notification()""")
    body = payload(clientRequestId=str(uuid4()))
    with backend_server() as base:
        student, _ = login(base, 'student001@test.edu')
        original = publish(student, base, body)
        assert execute(backend_database, 'SELECT count(*) FROM notifications WHERE request_id=%s', (original['id'],))[0][0] == 0
        execute(backend_database, 'DROP TRIGGER demo_notification_failure ON notifications; DROP FUNCTION fail_demo_notification()')
        assert publish(student, base, body)['id'] == original['id']
        assert execute(backend_database, "SELECT count(*) FROM notifications WHERE request_id=%s AND kind='request_match_summary'", (original['id'],))[0][0] == 1
        assert execute(backend_database, 'SELECT count(*) FROM requests WHERE title=%s', (body['title'],))[0][0] == 1


@pytest.fixture
def direct_request_router(backend_database, monkeypatch):
    from routers import requests as routes

    @contextmanager
    def local_db():
        conn = psycopg2.connect(backend_database, cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    monkeypatch.setattr(routes, 'db', local_db)
    return routes, Request({'type': 'http', 'session': {'user_id': 1}})


def test_delivery_observes_committed_request_tags_and_key(backend_database, direct_request_router, monkeypatch):
    routes, request = direct_request_router
    observed = []

    def delivery(row):
        # A separate DB connection can only see committed publication rows.
        observed.append(execute(backend_database, 'SELECT title FROM requests WHERE id=%s', (row['id'],)))
        assert execute(backend_database, 'SELECT count(*) FROM request_tags WHERE request_id=%s', (row['id'],))[0][0] == 2
        assert execute(backend_database, 'SELECT count(*) FROM request_submission_keys WHERE request_id=%s', (row['id'],))[0][0] == 1

    monkeypatch.setattr(routes, 'auto_match_request', delivery)
    result = routes.create_request(routes.CreateRequestBody(**payload(clientRequestId=str(uuid4()))), request)
    assert observed == [[(result['title'],)]]


def test_failed_publication_rolls_back_and_never_delivers(backend_database, direct_request_router, monkeypatch):
    routes, request = direct_request_router
    delivered = []
    monkeypatch.setattr(routes, 'auto_match_request', lambda row: delivered.append(row['id']))
    execute(backend_database, """CREATE FUNCTION fail_demo_request_tag() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Synthetic local request tag failure'; END $$;
        CREATE TRIGGER demo_request_tag_failure BEFORE INSERT ON request_tags
        FOR EACH ROW EXECUTE FUNCTION fail_demo_request_tag()""")
    body = routes.CreateRequestBody(**payload(clientRequestId=str(uuid4())))
    with pytest.raises(psycopg2.Error):
        routes.create_request(body, request)
    assert delivered == []
    assert execute(backend_database, 'SELECT count(*) FROM requests WHERE title=%s', (body.title,))[0][0] == 0
    # The failed transaction cannot consume the key or prevent a clean retry.
    execute(backend_database, 'DROP TRIGGER demo_request_tag_failure ON request_tags; DROP FUNCTION fail_demo_request_tag()')
    assert routes.create_request(body, request)['title'] == body.title
    assert len(delivered) == 1


def test_failed_commit_releases_key_and_does_not_deliver(backend_database, direct_request_router, monkeypatch):
    routes, request = direct_request_router
    delivered = []
    monkeypatch.setattr(routes, 'auto_match_request', lambda row: delivered.append(row['id']))
    execute(backend_database, """CREATE FUNCTION fail_demo_submission_commit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Synthetic local commit failure'; END $$;
        CREATE CONSTRAINT TRIGGER demo_submission_commit_failure AFTER INSERT ON request_submission_keys
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_demo_submission_commit()""")
    key = str(uuid4())
    body = routes.CreateRequestBody(**payload(clientRequestId=key))
    with pytest.raises(psycopg2.Error):
        routes.create_request(body, request)
    assert delivered == []
    assert execute(backend_database, 'SELECT count(*) FROM requests WHERE client_request_id=%s', (key,))[0][0] == 0
    assert execute(backend_database, 'SELECT count(*) FROM request_submission_keys WHERE client_request_id=%s', (key,))[0][0] == 0
    execute(backend_database, 'DROP TRIGGER demo_submission_commit_failure ON request_submission_keys; DROP FUNCTION fail_demo_submission_commit()')
    assert routes.create_request(body, request)['title'] == body.title
    assert len(delivered) == 1
