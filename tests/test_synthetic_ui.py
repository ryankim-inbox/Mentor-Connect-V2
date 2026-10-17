"""Synthetic seed: independent SQL / real gateway API / built browser UI comparison."""
from contextlib import closing
import os
from pathlib import Path
import subprocess
import uuid
from urllib.parse import urlsplit, urlunsplit

import psycopg2
from psycopg2 import sql
import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_seeded_dataset_through_built_ui_and_real_stack(tmp_path):
    admin_dsn = os.environ.get('CHAT_TEST_ADMIN_DSN')
    if not admin_dsn:
        pytest.skip('Run scripts/test-python.sh for a disposable PostgreSQL cluster')
    target = urlsplit(admin_dsn)
    assert target.hostname == '127.0.0.1', 'This test only accepts disposable loopback PostgreSQL'
    name = 'chat_test_' + uuid.uuid4().hex
    with closing(psycopg2.connect(admin_dsn)) as admin:
        admin.autocommit = True
        with admin.cursor() as cursor:
            cursor.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        try:
            netloc = target.netloc if target.username else admin.info.user + '@' + target.netloc
            database_url = urlunsplit(target._replace(netloc=netloc, path='/' + name))
            result = subprocess.run(
                ['node', 'tests/support/synthetic-ui.mjs'], cwd=ROOT,
                env={**os.environ, 'SYNTHETIC_UI_DATABASE_URL': database_url,
                     'SYNTHETIC_UI_TMP': str(tmp_path)},
                capture_output=True, text=True, timeout=150,
            )
            (tmp_path / 'synthetic-ui.log').write_text(result.stdout + result.stderr)
            assert result.returncode == 0, result.stdout + result.stderr
            print(result.stdout)
            print(f'Synthetic UI evidence: {tmp_path}')
        finally:
            with admin.cursor() as cursor:
                cursor.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
