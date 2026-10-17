"""Verification delivery keeps transactions safe without blocking the event loop."""
import asyncio
from concurrent.futures import TimeoutError as FutureTimeout
from contextlib import contextmanager
import hashlib
import json
from threading import Event, Thread, get_ident
from types import SimpleNamespace

from fastapi import FastAPI, HTTPException, Request
import pytest

from routers import auth
from security import require_user


class VerificationBoundary:
    """Only the DB and delivery side effects are replaced; the route stays real."""

    def __init__(self):
        self.user = {'id': 7, 'email': 'owner@tests.edu'}
        self.attempts = 0
        self.recent = False
        self.token_hash = '0' * 64
        self.delivery_failure = None
        self.commit_failure = False
        self.history = []
        self.deliveries = []
        self.transaction_threads = set()
        self.in_transaction = False
        self.gate = lambda boundary: None

    def authority(self, request: Request):
        self.gate('authority')
        user_id = request.session.get('user_id')
        if user_id is None:
            raise HTTPException(401, 'Not authenticated')
        return {'id': user_id, 'email': 'stale@tests.edu'}

    @contextmanager
    def transaction(self):
        self.gate('transaction')
        self.transaction_threads.add(get_ident())
        self.history.append('begin')
        self.in_transaction = True
        self.pending_attempts = self.attempts
        self.pending_token_hash = self.token_hash
        try:
            yield SimpleNamespace(cursor=lambda: self)
            self.gate('commit')
            self.transaction_threads.add(get_ident())
            if self.commit_failure:
                raise RuntimeError('Synthetic database commit failure')
            self.attempts = self.pending_attempts
            self.token_hash = self.pending_token_hash
            self.recent = self.attempts > 0
            self.history.append('commit')
        except Exception:
            self.history.append('rollback')
            raise
        finally:
            self.in_transaction = False
            self.history.append('close')

    def execute(self, query, params):
        self.transaction_threads.add(get_ident())
        if query.startswith('SELECT * FROM users'):
            self.history.append('lock')
            self.locked_user_id = params[0]
            self.row = self.user
        elif query.startswith('DELETE FROM email_verification_requests'):
            pass
        elif query.startswith('SELECT count(*)'):
            self.row = {'n': self.pending_attempts, 'recent': self.recent}
        elif query.startswith('INSERT INTO email_verification_requests'):
            self.pending_attempts += 1
            self.history.append('attempt')
        elif query.startswith('DELETE FROM email_verification_tokens'):
            self.pending_token_hash = None
            self.history.append('remove-token')
        elif query.startswith('INSERT INTO email_verification_tokens'):
            self.pending_token_hash = params[2]
            self.history.append('store-token')
        else:
            raise AssertionError('Unexpected verification database operation')

    def fetchone(self):
        self.transaction_threads.add(get_ident())
        return self.row

    def deliver(self, email, token):
        assert self.in_transaction
        assert self.history[-1] == 'attempt'
        self.gate('delivery')
        self.deliveries.append((email, hashlib.sha256(token.encode()).hexdigest()))
        self.history.append('delivery')
        if self.delivery_failure is not None:
            raise auth.DeliveryUnavailable(self.delivery_failure)


@pytest.fixture
def verification(monkeypatch):
    boundary = VerificationBoundary()
    monkeypatch.setattr(auth, 'require_user', boundary.authority)
    monkeypatch.setattr(auth, 'db', boundary.transaction)
    monkeypatch.setattr(auth, 'deliver_verification', boundary.deliver)
    app = FastAPI()
    app.include_router(auth.router, prefix='/api')
    # Confirmation also declares the original authority callable as a dependency.
    app.dependency_overrides[require_user] = boundary.authority

    @app.get('/api/healthz')
    def health():
        return {'status': 'ok'}

    return app, boundary


async def call(app, boundary, *, path='/api/auth/verification/request', body=b'',
               authenticated=True, method='POST'):
    messages = []
    error_type = None

    async def receive():
        return {'type': 'http.request', 'body': body, 'more_body': False}

    async def send(message):
        messages.append(message)
        if message['type'] == 'http.response.start' and path != '/api/healthz':
            boundary.history.append('response:' + str(message['status']))

    try:
        await app({
            'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
            'method': method, 'scheme': 'http', 'path': path,
            'raw_path': path.encode(), 'query_string': b'', 'root_path': '',
            'headers': [(b'content-type', b'application/json')],
            'client': ('127.0.0.1', 1), 'server': ('127.0.0.1', 2),
            'session': {'user_id': 7} if authenticated else {},
        }, receive, send)
    except Exception as error:
        # Retain only the type; an unexpected exception may contain private data.
        error_type = type(error)
    start = next(message for message in messages if message['type'] == 'http.response.start')
    response = b''.join(message.get('body', b'') for message in messages)
    return SimpleNamespace(status=start['status'], body=response, headers=start['headers'],
                           error_type=error_type)


@pytest.mark.parametrize('failure_kind', ['empty', 'private-detail'])
def test_delivery_failure_is_fixed_503_and_commits_attempt_preserving_token(verification, failure_kind):
    # Empty exception text must not turn failure into 202; provider text stays private.
    app, boundary = verification
    boundary.delivery_failure = '' if failure_kind == 'empty' else 'SYNTHETIC_PRIVATE_DELIVERY_DETAIL'
    previous = boundary.token_hash
    result = asyncio.run(call(app, boundary))

    assert result.status == 503
    assert json.loads(result.body) == {'detail': 'Email delivery unavailable'}
    assert result.error_type is None
    assert boundary.attempts == 1
    assert boundary.token_hash == previous
    assert len(boundary.deliveries) == 1
    assert boundary.history == ['begin', 'lock', 'attempt', 'delivery', 'commit', 'close', 'response:503']

    # A failed delivery still consumes the persisted cooldown; it is not retried.
    limited = asyncio.run(call(app, boundary))
    assert limited.status == 429
    assert (b'retry-after', b'60') in limited.headers
    assert boundary.attempts == 1
    assert boundary.token_hash == previous
    assert len(boundary.deliveries) == 1


def test_accepted_delivery_commits_digest_before_202(verification):
    app, boundary = verification
    result = asyncio.run(call(app, boundary))

    assert result.status == 202
    assert json.loads(result.body) == {'message': 'Verification email accepted for delivery'}
    assert result.error_type is None
    assert boundary.locked_user_id == 7
    assert boundary.deliveries == [('owner@tests.edu', boundary.token_hash)]
    assert boundary.token_hash != '0' * 64
    assert boundary.attempts == 1
    assert boundary.history == ['begin', 'lock', 'attempt', 'delivery', 'remove-token',
                                'store-token', 'commit', 'close', 'response:202']


def test_commit_failure_after_delivery_never_returns_202_or_retries(verification):
    app, boundary = verification
    boundary.commit_failure = True
    previous = boundary.token_hash
    result = asyncio.run(call(app, boundary))

    assert result.status == 500
    assert result.error_type is RuntimeError
    assert boundary.attempts == 0
    assert boundary.token_hash == previous
    assert len(boundary.deliveries) == 1
    assert 'commit' not in boundary.history
    assert boundary.history[-3:] == ['rollback', 'close', 'response:500']


@pytest.mark.parametrize('body', [b'{}', b'{"email":"other@tests.edu"}', b' '])
def test_request_body_cannot_choose_recipient_or_trigger_delivery(verification, body):
    app, boundary = verification
    result = asyncio.run(call(app, boundary, body=body))
    assert result.status == 422
    assert boundary.attempts == 0 and boundary.deliveries == []
    assert boundary.history == ['response:422']


def test_request_requires_current_session_before_delivery(verification):
    app, boundary = verification
    result = asyncio.run(call(app, boundary, authenticated=False, body=b'{}'))
    assert result.status == 401
    assert boundary.attempts == 0 and boundary.deliveries == []
    assert boundary.history == ['response:401']


def test_hourly_limit_does_not_send_or_replace_token(verification):
    app, boundary = verification
    boundary.attempts = 5
    previous = boundary.token_hash
    result = asyncio.run(call(app, boundary))
    assert result.status == 429
    assert boundary.attempts == 5 and boundary.deliveries == []
    assert boundary.token_hash == previous
    assert boundary.history == ['begin', 'lock', 'rollback', 'close', 'response:429']


@pytest.mark.parametrize('operation', ['request', 'confirm'])
def test_user_removed_after_authority_returns_401_before_attempt(verification, operation):
    app, boundary = verification
    boundary.user = None
    body = json.dumps({'token': 'A' * 43}).encode() if operation == 'confirm' else b''
    result = asyncio.run(call(app, boundary, path='/api/auth/verification/' + operation, body=body))
    assert result.status == 401
    assert json.loads(result.body) == {'detail': 'Not authenticated'}
    assert result.error_type is None
    assert boundary.attempts == 0 and boundary.deliveries == []
    assert boundary.history == ['begin', 'lock', 'rollback', 'close', 'response:401']


@pytest.mark.parametrize('phase', ['authority', 'transaction', 'delivery', 'commit'])
def test_verification_wait_allows_independent_health_response(verification, phase):
    # Moving any blocking boundary back onto the event loop stalls this real ASGI health call.
    app, boundary = verification
    entered, release = Event(), Event()
    outcome = {}

    def gate(name):
        if name == phase:
            entered.set()
            if not release.wait(10):
                raise AssertionError('verification gate was not released')

    boundary.gate = gate

    async def health_probe():
        response = await call(app, boundary, path='/api/healthz', method='GET')
        assert response.status == 200 and response.error_type is None
        return not release.is_set()

    async def exercise():
        loop = asyncio.get_running_loop()
        outcome['loop_thread'] = get_ident()

        def coordinate():
            try:
                assert entered.wait(3), 'verification never reached the selected boundary'
                future = asyncio.run_coroutine_threadsafe(health_probe(), loop)
                try:
                    outcome['health_before_release'] = future.result(timeout=3)
                except FutureTimeout:
                    outcome['health_before_release'] = False
                    future.cancel()
            except BaseException as error:
                outcome['error'] = error
            finally:
                release.set()

        coordinator = Thread(target=coordinate, daemon=True)
        coordinator.start()
        try:
            response = await call(app, boundary)
        finally:
            release.set()
            await asyncio.to_thread(coordinator.join, 5)
        assert not coordinator.is_alive()
        return response

    result = asyncio.run(exercise())
    if 'error' in outcome:
        raise outcome['error']
    assert outcome['health_before_release'], 'verification wait blocked the independent health response'
    assert result.status == 202 and result.error_type is None
    assert boundary.history[-3:] == ['commit', 'close', 'response:202']
    assert len(boundary.transaction_threads) == 1
    assert outcome['loop_thread'] not in boundary.transaction_threads
