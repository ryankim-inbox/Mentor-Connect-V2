"""Run one public gateway and one private FastAPI worker; never run migrations."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent


def supervise(commands):
    children = []
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, stop)
    failed = False
    try:
        for command in commands:
            children.append(subprocess.Popen(command, cwd=ROOT))
        while not stopping:
            if any(child.poll() is not None for child in children):
                failed = True
                break
            time.sleep(0.1)
    except Exception:
        # Command/environment details may contain credentials; keep logs fixed.
        print('service startup failed', file=sys.stderr)
        failed = True
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        deadline = time.monotonic() + 12
        for child in children:
            try:
                child.wait(timeout=max(0.01, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
    return int(failed)


def main():
    os.environ.setdefault('NODE_ENV', 'production')
    for name in ('DATABASE_URL', 'READINESS_DATABASE_URL', 'SESSION_SECRET', 'GATEWAY_PUBLIC_ORIGIN'):
        if not os.environ.get(name):
            print(f'{name} is required', file=sys.stderr)
            return 1
    if os.environ['NODE_ENV'] == 'production' and len(os.environ['SESSION_SECRET']) < 32:
        print('SESSION_SECRET must contain at least 32 characters', file=sys.stderr)
        return 1
    os.environ['GATEWAY_UPSTREAM_ORIGIN'] = 'http://127.0.0.1:8181'
    os.environ['GATEWAY_STATIC_DIR'] = str(ROOT/'artifacts/peerbridge/dist/public')
    os.environ.setdefault('NODE_OPTIONS', '--max-old-space-size=192')
    return supervise([
        [sys.executable, '-m', 'uvicorn', 'main:app', '--app-dir', str(ROOT/'Python'),
         '--host', '127.0.0.1', '--port', '8181', '--workers', '1',
         '--no-access-log', '--no-proxy-headers', '--timeout-graceful-shutdown', '10',
         '--ws-max-size', '16384', '--ws-max-queue', '8', '--ws-ping-interval', '20'],
        ['node', str(ROOT/'artifacts/api-gateway/dist/index.js')],
    ])


if __name__ == '__main__':
    raise SystemExit(main())
