"""Shared lesson scoring and committed, bounded in-app request delivery."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from threading import Barrier

import psycopg2
from psycopg2.extras import RealDictCursor
import pytest

import auto_match
import db
import find_matches as matching
from test_account_trust import execute


@pytest.fixture
def matching_db(backend_database, monkeypatch):
    monkeypatch.setattr(db, 'DATABASE_URL', backend_database)
    monkeypatch.setenv('DATABASE_URL', backend_database)
    execute(backend_database, "UPDATE users SET district_id=2,subjects='{}' WHERE id<>1")
    return backend_database


def add_mentor(dsn, user_id, **changes):
    execute(dsn, """INSERT INTO users
        (id,email,name,password_hash,role,district_id,subjects,email_verified_at,is_verified)
        VALUES (%s,%s,%s,'local-test-only','mentor',1,ARRAY['Math'],now(),true)""",
        (user_id, f'matching-{user_id}@test.edu', f'Mentor {user_id}'))
    execute(dsn, "INSERT INTO schedules(user_id,slot) VALUES (%s,'Mon 16:00')", (user_id,))
    # Only fixed test columns can be changed by this helper.
    for column, value in changes.items():
        assert column in {'is_admin', 'password_hash', 'role', 'district_id', 'subjects'}
        execute(dsn, f'UPDATE users SET {column}=%s WHERE id=%s', (value, user_id))


def committed_request(dsn, **changes):
    with closing(psycopg2.connect(dsn, cursor_factory=RealDictCursor)) as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO requests(author_id,district_id,title,description,role,preferred_times)
            VALUES (1,1,'Shared matching','Synthetic local test','mentee',ARRAY['Mon 16:00'])
            RETURNING *""")
        row = dict(cur.fetchone())
        cur.execute('INSERT INTO request_tags(request_id,tag_id) VALUES (%s,1)', (row['id'],))
        for column, value in changes.items():
            assert column in {'status', 'role', 'title'}
            cur.execute(f'UPDATE requests SET {column}=%s WHERE id=%s', (value, row['id']))
        conn.commit()
        return row


def deliveries(dsn, request_id):
    return execute(dsn, """SELECT user_id,kind,message FROM notifications
        WHERE request_id=%s ORDER BY id""", (request_id,))


def recipient_ids(dsn, request_id):
    return [row[0] for row in deliveries(dsn, request_id) if row[1] == 'request_match']


def test_shared_score_supports_tags_and_times_without_double_counting():
    student = {'id': 1, 'district': ' District '}
    mentor = {'id': 2, 'subjects': ['Math', 'Physics'], 'district': 'district',
              'available_times': ['Mon 16:00', 'Tue 17:00'], 'languages': ['English'],
              'teaching_style': 'Visual'}
    legacy = {'Subject': ' MATH ', 'preferred_time': 'Mon 16:00',
              'preferred_language': 'english', 'preferred_teaching_style': 'visual'}
    assert matching.calculate_match_score(student, mentor, legacy) == 110
    assert matching.calculate_match_score(
        student, mentor, {**legacy, 'subjects': [], 'preferred_times': []}) == 110
    production = {'subjects': ['math', 'Physics', 'math'],
                  'preferred_times': ['Mon 16:00', 'Tue 17:00']}
    assert matching.calculate_match_score(student, mentor, production) == 85
    assert matching.calculate_match_score({}, {'subjects': None}, {'subject': None}) == 0


def test_pure_ranking_uses_numeric_ties_excludes_self_and_zero_without_mutation():
    student = {'id': 1}
    mentors = [{'id': user_id, 'subjects': ['Math']} for user_id in ['10', '2', 1]]
    mentors.append({'id': 3, 'subjects': []})
    assert hasattr(matching, 'rank_candidates'), 'Both paths need the shared pure adapter'
    result = matching.rank_candidates(student, mentors, {'subjects': ['Math']}, limit=5)
    assert [row['mentor_id'] for row in result] == ['2', '10']
    assert [row['rank'] for row in result] == [1, 2]
    assert [row['score'] for row in result] == [50, 50]
    assert all('rank' not in mentor for mentor in mentors)


def test_top_five_filters_all_ineligible_candidates_before_limiting(matching_db):
    for user_id in range(3, 17):
        add_mentor(matching_db, user_id)
    execute(matching_db, "UPDATE users SET role='both',subjects=ARRAY['Math'] WHERE id=1")
    execute(matching_db, 'UPDATE users SET is_admin=true WHERE id=3')
    execute(matching_db, "UPDATE users SET password_hash='!mentor-connect-synthetic:v1:test' WHERE id=4")
    execute(matching_db, 'UPDATE users SET is_verified=false,email_verified_at=NULL WHERE id=5')
    execute(matching_db, "UPDATE users SET role='mentee' WHERE id=6")
    execute(matching_db, 'INSERT INTO blocks(blocker_id,blocked_user_id) VALUES (1,7),(8,1)')
    execute(matching_db, "UPDATE users SET district_id=2,subjects='{}' WHERE id=9")
    execute(matching_db, 'DELETE FROM schedules WHERE user_id IN (9,15,16)')
    execute(matching_db, "UPDATE users SET role='both' WHERE id=14")
    execute(matching_db, """INSERT INTO users
        (id,email,name,password_hash,role,district_id,subjects,email_verified_at,is_verified)
        SELECT n,'synthetic-'||n||'@test.edu','Synthetic demo',
            '!mentor-connect-synthetic:v1:demo','mentor',1,ARRAY['Math'],now(),true
        FROM generate_series(2000,2982) n""")
    request = committed_request(matching_db)
    assert auto_match.auto_match_request(request) == 5
    assert recipient_ids(matching_db, request['id']) == [5, 10, 11, 12, 13]
    assert len(deliveries(matching_db, request['id'])) == 6
    assert execute(matching_db, 'SELECT count(*) FROM request_applications')[0][0] == 0
    assert execute(matching_db, "SELECT count(*) FROM request_events WHERE kind='matched'")[0][0] == 0
    assert execute(matching_db, 'SELECT count(*) FROM dm_conversations')[0][0] == 2


def test_production_maps_district_and_schedules_to_shared_scoring(matching_db):
    add_mentor(matching_db, 10, district_id=2, subjects=[])
    add_mentor(matching_db, 11, subjects=[])
    add_mentor(matching_db, 12, district_id=2)
    execute(matching_db, 'DELETE FROM schedules WHERE user_id IN (11,12)')
    request = committed_request(matching_db)
    with db.db() as conn:
        ranked = auto_match.find_matches_for_request(conn.cursor(), request)
    assert [(row['mentor_id'], row['score']) for row in ranked] == [(12, 50), (11, 25), (10, 10)]
    assert auto_match.auto_match_request(request) == 3
    assert recipient_ids(matching_db, request['id']) == [12, 11, 10]


def test_legacy_lesson_matching_preserves_single_value_inputs_and_blocks(matching_db):
    add_mentor(matching_db, 10)
    add_mentor(matching_db, 11)
    execute(matching_db, """UPDATE users SET location='Lesson district',available_times=ARRAY['Mon 16:00'],
        languages=ARRAY['English'],teaching_style='Visual' WHERE id IN (1,10,11)""")
    execute(matching_db, """INSERT INTO questions
        (id,student_id,subject,preferred_time,preferred_language,preferred_teaching_style)
        VALUES (1,1,'Math','Mon 16:00','English','Visual')""")
    execute(matching_db, 'INSERT INTO blocks(blocker_id,blocked_user_id) VALUES (11,1)')
    result = matching.find_matches(1)
    assert result['success'] is True
    assert [(row['mentor_id'], row['score']) for row in result['matches']] == [(10, 110)]
    assert result['matches'][0]['matched_subjects'] == ['Math']


@pytest.mark.parametrize('change', ['closed', 'matched', 'mentor', 'deleted'])
def test_delivery_rereads_committed_request_and_skips_unavailable_state(matching_db, change):
    add_mentor(matching_db, 10)
    request = committed_request(matching_db)
    if change == 'deleted':
        execute(matching_db, 'DELETE FROM requests WHERE id=%s', (request['id'],))
    elif change == 'mentor':
        execute(matching_db, "UPDATE requests SET role='mentor' WHERE id=%s", (request['id'],))
    else:
        execute(matching_db, 'UPDATE requests SET status=%s WHERE id=%s', (change, request['id']))
    assert auto_match.auto_match_request(request) == 0
    assert deliveries(matching_db, request['id']) == []


def test_delivery_requires_current_student_author(matching_db):
    add_mentor(matching_db, 10)
    request = committed_request(matching_db)
    execute(matching_db, 'UPDATE users SET is_admin=true WHERE id=1')
    assert auto_match.auto_match_request(request) == 0
    assert deliveries(matching_db, request['id']) == []


@pytest.mark.parametrize('change', ['admin', 'unverified', 'synthetic', 'mentee', 'block_out', 'block_in'])
def test_delivery_rechecks_recipient_after_ranking(matching_db, monkeypatch, change):
    add_mentor(matching_db, 10)
    request = committed_request(matching_db)
    original = auto_match.find_matches_for_request

    def rank_then_revoke(cur, row, limit=5):
        result = original(cur, row, limit)
        query = {
            'admin': 'UPDATE users SET is_admin=true WHERE id=10',
            'unverified': 'UPDATE users SET is_verified=false,email_verified_at=NULL WHERE id=10',
            'synthetic': "UPDATE users SET password_hash='!mentor-connect-synthetic:v1:test' WHERE id=10",
            'mentee': "UPDATE users SET role='mentee' WHERE id=10",
            'block_out': 'INSERT INTO blocks(blocker_id,blocked_user_id) VALUES (1,10)',
            'block_in': 'INSERT INTO blocks(blocker_id,blocked_user_id) VALUES (10,1)',
        }[change]
        execute(matching_db, query)
        return result

    monkeypatch.setattr(auto_match, 'find_matches_for_request', rank_then_revoke)
    assert auto_match.auto_match_request(request) == (1 if change == 'unverified' else 0)
    assert recipient_ids(matching_db, request['id']) == ([10] if change == 'unverified' else [])
    assert [row[1] for row in deliveries(matching_db, request['id'])] == (
        ['request_match', 'request_match_summary'] if change == 'unverified' else ['request_match_summary'])


def test_completed_delivery_never_adds_replacements_on_retry(matching_db):
    for user_id in range(10, 16):
        add_mentor(matching_db, user_id)
    request = committed_request(matching_db)
    assert auto_match.auto_match_request(request) == 5
    before = deliveries(matching_db, request['id'])
    execute(matching_db, 'UPDATE users SET is_admin=true WHERE id=10')
    add_mentor(matching_db, 9)
    assert auto_match.auto_match_request(request) == 5
    assert deliveries(matching_db, request['id']) == before


def test_completed_zero_delivery_stays_completed_when_candidates_appear(matching_db):
    request = committed_request(matching_db)
    assert auto_match.auto_match_request(request) == 0
    before = deliveries(matching_db, request['id'])
    add_mentor(matching_db, 10)
    assert auto_match.auto_match_request(request) == 0
    assert deliveries(matching_db, request['id']) == before


def test_failed_delivery_rolls_back_all_alerts_and_can_retry(matching_db, caplog):
    add_mentor(matching_db, 10)
    request = committed_request(matching_db)
    execute(matching_db, """CREATE FUNCTION fail_match_summary() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.kind='request_match_summary' THEN RAISE EXCEPTION 'private failure details';
        END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_match_summary BEFORE INSERT ON notifications
        FOR EACH ROW EXECUTE FUNCTION fail_match_summary()""")
    assert auto_match.auto_match_request(request) == 0
    assert deliveries(matching_db, request['id']) == []
    assert 'private failure details' not in caplog.text
    assert execute(matching_db, 'SELECT count(*) FROM requests WHERE id=%s', (request['id'],))[0][0] == 1
    execute(matching_db, 'DROP TRIGGER fail_match_summary ON notifications')
    assert auto_match.auto_match_request(request) == 1
    assert len(deliveries(matching_db, request['id'])) == 2


def test_concurrent_retries_deliver_once(matching_db):
    add_mentor(matching_db, 10)
    request = committed_request(matching_db)
    ready = Barrier(2)

    def deliver():
        ready.wait(timeout=5)
        return auto_match.auto_match_request(request)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: deliver(), range(2)))
    assert results == [1, 1]
    assert len(deliveries(matching_db, request['id'])) == 2


def test_failed_request_transaction_cannot_deliver_from_stale_snapshot(matching_db):
    add_mentor(matching_db, 10)
    with closing(psycopg2.connect(matching_db, cursor_factory=RealDictCursor)) as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO requests(author_id,district_id,title,description,role)
            VALUES (1,1,'Rolled back','Synthetic test','mentee') RETURNING *""")
        row = dict(cur.fetchone())
        conn.rollback()
    assert auto_match.auto_match_request(row) == 0
    assert execute(matching_db, 'SELECT count(*) FROM notifications')[0][0] == 0


def test_notification_messages_preserve_api_length_bound_for_legacy_titles(matching_db):
    add_mentor(matching_db, 10)
    request = committed_request(matching_db, title='Long legacy title ' * 100)
    assert auto_match.auto_match_request(request) == 1
    messages = [row[2] for row in deliveries(matching_db, request['id'])]
    assert all(0 < len(message) <= 1000 for message in messages)
