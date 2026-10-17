"""Full built SPA + gateway + real Python + disposable Postgres over local TLS."""
import os
from contextlib import closing
from pathlib import Path
import subprocess
import uuid
from urllib.parse import urlsplit, urlunsplit

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import make_dsn
import pytest

ROOT = Path(__file__).resolve().parent.parent


def test_two_browser_contexts_on_real_local_https_stack(tmp_path):
    admin_dsn = os.environ.get('CHAT_TEST_ADMIN_DSN')
    if not admin_dsn:
        pytest.skip('Run scripts/test-python.sh for a disposable PostgreSQL cluster')
    name = 'chat_test_' + uuid.uuid4().hex
    with closing(psycopg2.connect(admin_dsn)) as admin:
        admin.autocommit = True
        with admin.cursor() as cur:
            cur.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        dsn = make_dsn(admin_dsn, dbname=name)
        try:
            parts = urlsplit(admin_dsn)
            netloc = parts.netloc if parts.username else admin.info.user + '@' + parts.netloc
            node_url = urlunsplit(parts._replace(netloc=netloc, path='/' + name))
            env = {**os.environ, 'LIVE_LOCAL_DATABASE_URL': node_url, 'LIVE_LOCAL_TMP': str(tmp_path)}
            # Container mode performs three constrained starts, including AMD64 emulation.
            timeout = 480 if env.get('DEPLOYMENT_TEST_IMAGE') else 180
            result = subprocess.run(['node', 'tests/support/live-deployment.mjs'], cwd=ROOT, env=env,
                                    capture_output=True, text=True, timeout=timeout)
            assert result.returncode == 0, result.stdout + result.stderr
            print(result.stdout)
        finally:
            with admin.cursor() as cur:
                cur.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
