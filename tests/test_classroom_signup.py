"""The local classroom seed uses the same new-signup contract as the UI."""
from contextlib import closing
from datetime import date
import getpass
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import quote
from urllib.request import build_opener

import psycopg2
from psycopg2.extensions import parse_dsn

from backend_support import api


ROOT = Path(__file__).resolve().parents[1]


def test_local_classroom_seed_registers_with_private_fields_and_valid_passwords(backend_database, backend_server, tmp_path):
    target = parse_dsn(backend_database)
    assert target['host'] in ('127.0.0.1', 'localhost', '::1')
    assert target['dbname'].startswith('chat_test_')
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
        conn.commit()
    url = f"postgresql://{quote(target.get('user', getpass.getuser()), safe='')}@{target['host']}:{target['port']}/{target['dbname']}"
    credentials = tmp_path / 'credentials.json'
    environment = {**os.environ, 'CLASSROOM_DATABASE_URL': url,
                   'CLASSROOM_ALLOWED_HOST': target['host'], 'CLASSROOM_DATABASE_NAME': target['dbname'],
                   'CLASSROOM_APP_SHA': '78b65d974432f73d5abc296b19811c10c9802c3c',
                   'CLASSROOM_CREDENTIAL_FILE': str(credentials)}
    subprocess.run(['node', 'ops/bootstrap-classroom.mjs'], cwd=ROOT, env=environment, check=True, capture_output=True)
    with backend_server() as base:
        seeded = subprocess.run(['node', 'ops/seed-classroom.mjs'], cwd=ROOT,
                                env={**environment, 'CLASSROOM_ORIGIN': base}, capture_output=True, text=True)
        assert seeded.returncode == 0, seeded.stderr
        generated = json.loads(credentials.read_text())
        assert credentials.stat().st_mode & 0o777 == 0o600
        assert set(generated['accounts']) == {'mentor', 'mentee'}
        for account in generated['accounts'].values():
            assert account['password'] not in seeded.stdout + seeded.stderr
            status, user = api(build_opener(), base, 'POST', '/api/auth/login',
                               {'email': account['email'], 'password': account['password']})
            assert status == 200, user
            assert 'gender' not in user['user'] and 'dateOfBirth' not in user['user']
    with closing(psycopg2.connect(backend_database)) as conn, conn.cursor() as cur:
        cur.execute('SELECT role, gender, date_of_birth FROM users ORDER BY role')
        assert cur.fetchall() == [('mentee', 'female', date(2008, 1, 1)), ('mentor', 'male', date(2008, 1, 1))]
