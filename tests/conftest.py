import os
import sys
import socket
import subprocess
import time
import uuid
from contextlib import closing, contextmanager
from pathlib import Path
from urllib.error import URLError
from urllib.request import build_opener

import psycopg2
from psycopg2 import sql
from psycopg2.extensions import make_dsn
import pytest
from backend_support import api


# The FastAPI server and adapters live in Python/ and import each other as
# top-level modules (integration_api, db, api.*), so mirror the server's cwd.
PYTHON_DIR = Path(__file__).resolve().parent.parent / "Python"
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

# Unit-test imports need a placeholder; integration servers receive disposable DSNs.
os.environ.setdefault("DATABASE_URL", "postgresql://tests@localhost:5432/tests")

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def backend_database():
    admin_dsn = os.environ.get("CHAT_TEST_ADMIN_DSN")
    if not admin_dsn:
        pytest.skip("Set CHAT_TEST_ADMIN_DSN to run isolated PostgreSQL integration tests")
    name = "chat_test_" + uuid.uuid4().hex
    with closing(psycopg2.connect(admin_dsn)) as admin:
        admin.autocommit = True
        with admin.cursor() as cur:
            cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        dsn = make_dsn(admin_dsn, dbname=name)
        try:
            with closing(psycopg2.connect(dsn)) as conn, conn.cursor() as cur:
                cur.execute((ROOT / "database/schema/canonical.sql").read_text())
                cur.execute((ROOT / "tests/fixtures/chat-canonical.sql").read_text())
                conn.commit()
            yield dsn
        finally:
            with admin.cursor() as cur:
                cur.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


@pytest.fixture
def backend_server(backend_database, tmp_path_factory):
    @contextmanager
    def running():
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        log_path = tmp_path_factory.mktemp("chat-server") / "server.log"
        with log_path.open("w+") as log:
            process = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1",
                 "--port", str(port), "--ws", "websockets-sansio"],
                cwd=ROOT / "Python", stdout=log, stderr=log,
                env={**os.environ, "DATABASE_URL": backend_database,
                     "SESSION_SECRET": "chat-integration-test", "NODE_ENV": "test"},
            )
            try:
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline and process.poll() is None:
                    try:
                        if api(build_opener(), base, "GET", "/api/healthz")[0] == 200:
                            break
                    except URLError:
                        time.sleep(0.05)
                else:
                    pytest.fail("Chat server failed to start:\n" + log_path.read_text())
                yield base
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
    return running


@pytest.fixture
def chat_database(backend_database):
    return backend_database


@pytest.fixture
def chat_server(backend_server):
    return backend_server


@pytest.fixture
def gateway_server(backend_server, tmp_path):
    with backend_server() as backend:
        log_path = tmp_path / "gateway.log"
        address_path = tmp_path / "gateway.url"
        with log_path.open("w+") as log:
            process = subprocess.Popen(
                [str(ROOT / "artifacts/api-gateway/node_modules/.bin/tsx"), str(ROOT / "tests/support/gateway-server.ts")],
                cwd=ROOT, stdout=log, stderr=log,
                env={**os.environ, "NODE_ENV": "test", "TEST_BACKEND_ORIGIN": backend,
                     "TEST_GATEWAY_ADDRESS_PATH": str(address_path)},
            )
            try:
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline and process.poll() is None:
                    if address_path.exists():
                        yield address_path.read_text()
                        break
                    time.sleep(0.05)
                else:
                    pytest.fail("Gateway failed to start:\n" + log_path.read_text())
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
