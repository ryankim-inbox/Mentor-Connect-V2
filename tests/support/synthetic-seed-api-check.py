"""Disposable-only crosscheck: real FastAPI routes against independent SQL.

Receives a local fixture DSN, never loads dotenv or calls a mail provider.
The seed itself remains entirely independent of this test utility.
"""
import base64
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

dsn = sys.argv[1]
target = urlsplit(dsn)
assert target.hostname == '127.0.0.1' and target.path == '/synthetic_exact', 'Disposable fixture only'
os.environ.update(DATABASE_URL=dsn, SESSION_SECRET='synthetic-disposable-only',
                  PYTHON_DOTENV_DISABLED='1', NODE_ENV='test', EMAIL_DELIVERY_MODE='disabled')
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'Python'))
from main import app
from routers import auth


def cookie(user_id):
    return TimestampSigner(os.environ['SESSION_SECRET']).sign(
        base64.b64encode(json.dumps({'user_id': user_id}).encode())).decode()


def forbidden_mail(*args, **kwargs):
    raise AssertionError('Synthetic identity must never reach email delivery')


auth.deliver_verification = forbidden_mail
with psycopg2.connect(dsn, cursor_factory=RealDictCursor) as connection, connection.cursor() as cur, TestClient(app, raise_server_exceptions=False) as client:
    def rows(sql, params=None):
        cur.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]

    def get(path):
        response = client.get(path)
        assert response.status_code == 200, (path, response.status_code, response.text)
        return response.json()

    def data(path):
        result = get(path)
        assert result['ok'] and result['source'] == ('student-module' if '/python-reports/' in path else 'python'), result
        assert result['student_module']['called'], result
        return result['data']

    batch_user = rows("SELECT id,email FROM users WHERE email LIKE 'student-0001@%.invalid'")[0]
    client.cookies.set('peerbridge_session', cookie(1))
    summary = rows("""SELECT count(*) FILTER (WHERE (created_at AT TIME ZONE 'UTC')::date=(now() AT TIME ZONE 'UTC')::date)::int AS today,
      count(*) FILTER (WHERE date_trunc('month',created_at AT TIME ZONE 'UTC')=date_trunc('month',now() AT TIME ZONE 'UTC'))::int AS "thisMonth",
      count(*) FILTER (WHERE date_trunc('year',created_at AT TIME ZONE 'UTC')=date_trunc('year',now() AT TIME ZONE 'UTC'))::int AS "thisYear",
      count(*)::int AS total FROM users""")[0]
    assert data('/api/python-reports/summary') == summary
    subjects = rows('''SELECT t.name AS subject,count(*)::int AS requests,t.color FROM request_tags rt
      JOIN tags t ON t.id=rt.tag_id GROUP BY t.id ORDER BY requests DESC,t.id LIMIT 10''')
    assert data('/api/analytics/popular-subjects') == subjects
    expected_slots = rows("""SELECT slot,count(DISTINCT u.id)::int AS count FROM users u
      CROSS JOIN LATERAL unnest(u.available_times) AS slot GROUP BY slot
      ORDER BY array_position(ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],substring(slot,1,3)),substring(slot,5)""")
    assert data('/api/analytics/popular-time-slots') == expected_slots
    expected_weeks = {str(row['week']): row['matches'] for row in rows("""SELECT date_trunc('week',occurred_at AT TIME ZONE 'UTC')::date AS week,
      count(*)::int AS matches FROM request_events WHERE kind='matched' AND occurred_at<=now() GROUP BY week""")}
    weekly = data('/api/analytics/weekly-matches')
    assert len(weekly) == 8
    for week in weekly:
        assert week['coverage'] == 'complete'
        assert week['matches'] == expected_weeks.get(week['week'], 0)
    expected_ranks = rows("""SELECT u.id AS "mentorId",u.name AS "mentorName",count(e.id)::int AS "totalMatches",
      avg(extract(epoch FROM (e.occurred_at-e.request_created_at))/3600)::float AS "avgTimeToMatchHours"
      FROM users u LEFT JOIN request_events e ON e.mentor_id=u.id AND e.kind='matched' AND e.occurred_at<=now()
      WHERE u.role IN ('mentor','both') GROUP BY u.id ORDER BY count(e.id) DESC,u.id""")
    ranks = data('/api/analytics/mentor-response-rates')['mentors']
    assert len(ranks) == len(expected_ranks)
    for actual, expected in zip(ranks, expected_ranks):
        for key in ['mentorId','mentorName','totalMatches']:
            assert actual[key] == expected[key]
        if expected['avgTimeToMatchHours'] is None:
            assert actual['avgTimeToMatchHours'] is None
        else:
            assert abs(actual['avgTimeToMatchHours']-expected['avgTimeToMatchHours']) < 0.000001
    assert sum(row['totalMatches'] for row in ranks) == 312
    assert get('/api/admin/reports') == []
    stats = get('/api/stats/overview')
    assert stats['totalUsers'] == 984 and stats['openRequests'] == 471 and stats['successfulMatches'] == 234
    feed = get('/api/requests?limit=50')
    assert len(feed) == 50
    next_page = get('/api/requests?limit=50&before=' + feed[-1]['createdAt'].replace('+','%2B') + '%7C' + str(feed[-1]['id']))
    assert len(next_page) == 50 and not ({row['id'] for row in feed} & {row['id'] for row in next_page})
    matched = get('/api/requests?status=matched&limit=50')
    assert len(matched) == 50 and all(row['status'] == 'matched' and row['matchedUserId'] is not None for row in matched)
    assert client.get('/api/requests?limit=983').status_code == 422
    first_question = rows('SELECT min(id) AS id FROM questions')[0]['id']
    matching = get(f'/api/matches/{first_question}?limit=5')
    assert matching['success'] and matching['matches'], matching
    assert len(matching['matches']) <= 5
    assert all(row['mentor_name'].startswith('[Synthetic]') for row in matching['matches'])
    assert get('/api/mentors') == []  # Fixture admin is self; synthetic records are not verified members.
    restricted = ['/api/analytics/weekly-matches','/api/analysis/status','/api/python-reports/summary',
                  '/api/python-reports/status','/api/admin/reports','/api/practice/status',f'/api/matches/{first_question}']
    # A verified ordinary member can browse feed, but none of the admin surfaces.
    cur.execute('UPDATE users SET is_admin=false WHERE id=1')
    connection.commit()
    try:
        assert client.get('/api/requests').status_code == 200
        for endpoint in restricted:
            assert client.get(endpoint).status_code == 403, endpoint
    finally:
        cur.execute('UPDATE users SET is_admin=true WHERE id=1')
        connection.commit()
    client.cookies.clear()
    for endpoint in restricted:
        assert client.get(endpoint).status_code == 401, endpoint
    login = client.post('/api/auth/login', json={'email':batch_user['email'],'password':'anything'})
    assert login.status_code == 401, login.text
    client.cookies.set('peerbridge_session', cookie(batch_user['id']))
    for endpoint in ['/api/auth/me','/api/requests',*restricted]:
        assert client.get(endpoint).status_code == 401, endpoint
    assert client.post('/api/auth/verification/request').status_code == 401
    assert rows('SELECT count(*)::int AS n FROM email_verification_requests')[0]['n'] == 0
    assert rows('SELECT count(*)::int AS n FROM email_verification_tokens')[0]['n'] == 0
    print(json.dumps({'ok':True,'users':summary['total'],'syntheticUsers':983,'questions':782,'requestPosts':782,
                      'signupSummary':summary,'subjects':subjects,'slots':expected_slots,
                      'matchedEvents':sum(row['totalMatches'] for row in ranks),'feedPageSize':len(feed),
                      'adminOnlyEndpointsDenied':len(restricted),'syntheticLoginAndMailDenied':True}))
