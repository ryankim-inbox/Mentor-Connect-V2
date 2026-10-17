"""No network: exercise the real HTTP client against an injected transport."""
import asyncio
import json
import socket
import ssl
import time
from threading import Event
from uuid import UUID

import anyio
import httpcore
import httpx
import pytest

import email_delivery as delivery
from routers import auth
from test_verification_delivery_boundary import call, verification


RECIPIENT = 'approved@example.com'
TOKEN = 'synthetic-url-safe-token-' + 'A' * 24
KEY = 'synthetic-resend-credential-never-log'
MESSAGE_ID = '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794'


@pytest.fixture
def configuration(monkeypatch):
    for key, value in {
        'EMAIL_DELIVERY_MODE': 'resend-test',
        'EMAIL_TEST_ALLOWLIST_ENABLED': 'true',
        'EMAIL_TEST_RECIPIENT': RECIPIENT,
        'RESEND_API_KEY': KEY,
        'APP_ORIGIN': 'https://mentor-test.example.com',
        'GATEWAY_PUBLIC_ORIGIN': 'https://mentor-test.example.com',
        'NODE_ENV': 'production',
    }.items():
        monkeypatch.setenv(key, value)


@pytest.fixture
def configured(configuration, monkeypatch):
    calls, clients = [], []

    def use_response(response=None, handler=None):
        async def send(request):
            calls.append(request)
            if handler is not None:
                return await handler(request)
            return response if response is not None else httpx.Response(200, json={'id': MESSAGE_ID})

        def client():
            result = httpx.AsyncClient(transport=httpx.MockTransport(send),
                                      trust_env=False, follow_redirects=False)
            clients.append(result)
            return result

        monkeypatch.setattr(delivery, '_new_resend_client', client, raising=False)

    use_response()
    return calls, clients, use_response


def send(recipient=RECIPIENT, token=TOKEN):
    async def from_route_worker():
        return await anyio.to_thread.run_sync(delivery.deliver_verification, recipient, token)

    return asyncio.run(from_route_worker())


def test_acceptance_sends_one_fixed_plaintext_message_and_no_sensitive_metadata(configured, caplog):
    calls, clients, _ = configured
    assert send() is None
    assert len(calls) == 1 and clients[0].is_closed
    request = calls[0]
    assert request.method == 'POST' and str(request.url) == 'https://api.resend.com/emails'
    assert request.headers['authorization'] == 'Bearer ' + KEY
    assert UUID(request.headers['idempotency-key'])
    body = json.loads(request.content)
    assert set(body) == {'from', 'to', 'subject', 'text'}
    assert body['from'] == 'Mentor-Connect <onboarding@resend.dev>'
    assert body['to'] == [RECIPIENT]
    assert body['subject'] == 'Mentor-Connect email verification'
    assert 'https://mentor-test.example.com/verify-email#token=' + TOKEN in body['text']
    assert '30 minutes' in body['text']
    assert TOKEN not in str(request.url) + str(request.headers)
    assert TOKEN not in caplog.text and KEY not in caplog.text and RECIPIENT not in caplog.text


def test_distinct_deliberate_calls_get_distinct_attempt_keys(configured):
    calls, _, _ = configured
    send()
    send()
    assert len(calls) == 2
    assert calls[0].headers['idempotency-key'] != calls[1].headers['idempotency-key']


@pytest.mark.parametrize('status', [201, 202, 301, 302, 307, 308, 400, 401, 403, 409, 429, 500, 503])
def test_unconfirmed_status_never_follows_redirect_or_retries(configured, status, caplog):
    calls, clients, use_response = configured
    use_response(httpx.Response(status, text=KEY + TOKEN + RECIPIENT,
                                headers={'location': 'https://untrusted.example/secret'}))
    with pytest.raises(delivery.DeliveryUnavailable) as error:
        send()
    assert str(error.value) == 'Email delivery unavailable'
    assert len(calls) == 1 and clients[0].is_closed
    assert TOKEN not in caplog.text and KEY not in caplog.text and RECIPIENT not in caplog.text


@pytest.mark.parametrize('body', [b'not json', b'[]', b'null', b'{}', b'{"id":1}',
                                b'{"id":"not-a-message-id"}', b'{"id":"' + b'x' * 17000 + b'"}'])
def test_malformed_or_oversized_acceptance_is_unconfirmed(configured, body):
    calls, clients, use_response = configured
    use_response(httpx.Response(200, content=body, headers={'content-type': 'application/json'}))
    with pytest.raises(delivery.DeliveryUnavailable):
        send()
    assert len(calls) == 1 and clients[0].is_closed


@pytest.mark.parametrize('exception', [httpx.ConnectTimeout, httpx.WriteTimeout,
                                     httpx.ReadTimeout, httpx.RemoteProtocolError])
def test_transport_failures_are_fixed_and_never_retried(configured, exception, caplog):
    calls, clients, use_response = configured

    async def fail(request):
        raise exception(KEY + TOKEN, request=request)

    use_response(handler=fail)
    with pytest.raises(delivery.DeliveryUnavailable) as error:
        send()
    assert str(error.value) == 'Email delivery unavailable'
    assert error.value.__suppress_context__
    assert len(calls) == 1 and clients[0].is_closed
    assert KEY not in caplog.text and TOKEN not in caplog.text


@pytest.mark.parametrize('key,value', [
    ('EMAIL_DELIVERY_MODE', 'disabled'), ('EMAIL_DELIVERY_MODE', 'resend'),
    ('EMAIL_TEST_ALLOWLIST_ENABLED', ''), ('EMAIL_TEST_ALLOWLIST_ENABLED', 'false'),
    ('EMAIL_TEST_RECIPIENT', ''), ('EMAIL_TEST_RECIPIENT', 'other@example.com'),
    ('EMAIL_TEST_RECIPIENT', '*.example.com'), ('RESEND_API_KEY', ''),
    ('RESEND_API_KEY', 'bad\r\nvalue'), ('APP_ORIGIN', 'http://mentor-test.example.com'),
    ('APP_ORIGIN', 'https://user:pass@mentor-test.example.com'),
    ('APP_ORIGIN', 'https://mentor-test.example.com/path'),
    ('APP_ORIGIN', 'https://mentor-test.example.com?query=1'),
    ('APP_ORIGIN', 'https://mentor-test.example.com#fragment'),
    ('APP_ORIGIN', 'https://mentor-test.example.com\n'),
    ('APP_ORIGIN', 'https://mentor-test.example.com\\evil'),
    ('APP_ORIGIN', 'https://mentor-test.example.com:bad'),
    ('APP_ORIGIN', 'https://[malformed'),
    ('GATEWAY_PUBLIC_ORIGIN', 'https://other.example.com'),
])
def test_configuration_fails_closed_before_network(configured, monkeypatch, key, value):
    calls, clients, _ = configured
    monkeypatch.setenv(key, value)
    with pytest.raises(delivery.DeliveryUnavailable):
        send()
    assert calls == [] and clients == []


@pytest.mark.parametrize('recipient', ['other@example.com', 'approved+extra@example.com',
                                     'Approved <approved@example.com>', 'approved@example.com\n',
                                     'approved@example.com,other@example.com'])
def test_sender_cannot_expand_exact_recipient(configured, recipient):
    calls, clients, _ = configured
    with pytest.raises(delivery.DeliveryUnavailable):
        send(recipient=recipient)
    assert calls == [] and clients == []


@pytest.mark.parametrize('token', ['', 'short', 'A' * 129, 'A' * 43 + '\r\n'])
def test_invalid_tokens_never_reach_network(configured, token):
    calls, clients, _ = configured
    with pytest.raises(delivery.DeliveryUnavailable):
        send(token=token)
    assert calls == [] and clients == []


def test_total_deadline_includes_slow_stream_and_closes_without_retry(configured, monkeypatch):
    calls, clients, use_response = configured
    closed = []

    class SlowBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            while True:
                await asyncio.sleep(0.01)
                yield b' '

        async def aclose(self):
            closed.append(True)

    use_response(httpx.Response(200, stream=SlowBody(), headers={'content-type': 'application/json'}))
    monkeypatch.setattr(delivery, '_SEND_DEADLINE_SECONDS', 0.06, raising=False)
    start = time.monotonic()
    with pytest.raises(delivery.DeliveryUnavailable):
        send()
    assert time.monotonic() - start < 1
    assert len(calls) == 1 and clients[0].is_closed and closed


def test_dns_deadline_releases_route_transaction_before_resolver_finishes(
        configuration, verification, monkeypatch):
    # Keep HTTPX/HTTPcore real. No synthetic resolver result may open a socket.
    app, boundary = verification
    boundary.user['email'] = RECIPIENT
    previous_token = boundary.token_hash
    monkeypatch.setattr(auth, 'deliver_verification', delivery.deliver_verification)
    monkeypatch.setattr(delivery, '_SEND_DEADLINE_SECONDS', 0.05)
    entered, release, finished = Event(), Event(), Event()
    resolutions, connections = [], []

    def slow_dns(host, port, *args, **kwargs):
        resolutions.append((host, port))
        entered.set()
        try:
            assert release.wait(2), 'Synthetic resolver was not released'
            return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', ('127.0.0.1', 9))]
        finally:
            finished.set()

    def no_connect(sock, address):
        connections.append(address)
        raise AssertionError('Cancelled DNS resolution attempted a socket connection')

    monkeypatch.setattr(socket, 'getaddrinfo', slow_dns)
    monkeypatch.setattr(socket.socket, 'connect', no_connect)
    monkeypatch.setattr(socket.socket, 'connect_ex', no_connect)

    async def exercise():
        task = asyncio.create_task(call(app, boundary))
        try:
            async with asyncio.timeout(1):
                while not entered.is_set():
                    await asyncio.sleep(0.001)
            done, _ = await asyncio.wait({task}, timeout=0.20)
            returned_before_dns = bool(done)
            transaction_released = not boundary.in_transaction
            resolver_still_blocked = not finished.is_set()
        finally:
            release.set()
            response = await asyncio.wait_for(task, timeout=2)
            async with asyncio.timeout(1):
                while not finished.is_set():
                    await asyncio.sleep(0.001)
            # Give a wrongly abandoned send a chance to consume the DNS result.
            await asyncio.sleep(0.02)
        return response, returned_before_dns, transaction_released, resolver_still_blocked

    result, returned, released, blocked = asyncio.run(exercise())
    assert returned, 'Synchronous delivery waited for resolver cleanup after its deadline'
    assert released and blocked, 'Account transaction stayed open until DNS finished'
    assert result.status == 503 and result.error_type is None
    assert json.loads(result.body) == {'detail': 'Email delivery unavailable'}
    assert boundary.history[-3:] == ['commit', 'close', 'response:503']
    assert boundary.attempts == 1 and boundary.token_hash == previous_token
    assert len(resolutions) == 1 and connections == []


def test_deep_json_is_normalized_to_unconfirmed_delivery(configured, monkeypatch, caplog):
    calls, clients, use_response = configured
    # Use the stdlib Python scanner for a consistent recursion limit across builds;
    # some CPython C scanners accept every nesting depth within our byte budget.
    decoder = json.JSONDecoder()
    decoder.scan_once = json.scanner.py_make_scanner(decoder)
    monkeypatch.setattr(json, '_default_decoder', decoder)
    # Under the byte limit, but over this real JSON decoder's recursion depth.
    nested = b'[' * 2000 + b'0' + b']' * 2000
    use_response(httpx.Response(200, content=nested, headers={'content-type': 'application/json'}))
    with pytest.raises(delivery.DeliveryUnavailable) as error:
        send()
    assert str(error.value) == 'Email delivery unavailable'
    assert error.value.__suppress_context__
    assert len(calls) == 1 and clients[0].is_closed
    assert TOKEN not in caplog.text and KEY not in caplog.text


def test_stream_limit_applies_without_content_length_and_closes_early(configured):
    calls, clients, use_response = configured
    yielded, closed = [], []

    class OversizedBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            for index in range(40):
                yielded.append(index)
                yield b' ' * 1024

        async def aclose(self):
            closed.append(True)

    response = httpx.Response(200, stream=OversizedBody(), headers={'content-type': 'application/json'})
    assert 'content-length' not in response.headers
    use_response(response)
    with pytest.raises(delivery.DeliveryUnavailable) as error:
        send()
    assert str(error.value) == 'Email delivery unavailable'
    assert len(yielded) == 17  # The first chunk over the 16-KiB cap stops consumption.
    assert len(calls) == 1 and clients[0].is_closed and closed


def test_total_deadline_includes_delayed_headers_and_cancels_send(configured, monkeypatch):
    calls, clients, use_response = configured
    cancelled, completed = [], []

    async def delayed_headers(request):
        try:
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            cancelled.append(True)
            raise
        completed.append(True)
        return httpx.Response(200, json={'id': MESSAGE_ID})

    use_response(handler=delayed_headers)
    monkeypatch.setattr(delivery, '_SEND_DEADLINE_SECONDS', 0.05)
    started = time.monotonic()
    with pytest.raises(delivery.DeliveryUnavailable):
        send()
    assert time.monotonic() - started < 0.5
    assert len(calls) == 1 and clients[0].is_closed
    assert cancelled and not completed


@pytest.mark.parametrize('headers', [
    {}, {'content-type': 'text/plain'}, {'content-type': 'application/jsonx'},
    {'content-type': 'application/json', 'content-encoding': 'unknown'},
    {'content-type': 'application/json', 'content-encoding': 'gzip'},
    {'content-type': 'application/json', 'content-encoding': 'identity, gzip'},
])
def test_invalid_response_metadata_never_becomes_acceptance(configured, headers):
    calls, clients, use_response = configured
    closed = []

    class UnreadBody(httpx.AsyncByteStream):
        async def __aiter__(self):
            pytest.fail('Rejected response metadata must not consume the response body')
            yield b''

        async def aclose(self):
            closed.append(True)

    use_response(httpx.Response(200, stream=UnreadBody(), headers=headers))
    with pytest.raises(delivery.DeliveryUnavailable):
        send()
    assert len(calls) == 1 and clients[0].is_closed and closed


def test_real_transport_ignores_proxy_and_tls_environment(configuration, monkeypatch, tmp_path):
    from httpcore._backends.anyio import AnyIOBackend

    for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'):
        monkeypatch.setenv(key, 'http://synthetic-proxy.invalid:8080')
    monkeypatch.setenv('NO_PROXY', '')
    monkeypatch.setenv('no_proxy', '')
    monkeypatch.setenv('SSL_CERT_FILE', str(tmp_path / 'missing-ca.pem'))
    monkeypatch.setenv('SSL_CERT_DIR', str(tmp_path / 'missing-ca-dir'))
    connections, handshakes, writes, closed = [], [], [], []
    body = json.dumps({'id': MESSAGE_ID}).encode()
    response = (b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: '
                + str(len(body)).encode() + b'\r\n\r\n' + body)

    class SyntheticSocket(httpcore.AsyncNetworkStream):
        async def read(self, max_bytes, timeout=None):
            nonlocal response
            result, response = response[:max_bytes], response[max_bytes:]
            return result

        async def write(self, buffer, timeout=None):
            writes.append(buffer)

        async def aclose(self):
            closed.append(True)

        async def start_tls(self, ssl_context, server_hostname=None, timeout=None):
            handshakes.append((ssl_context.verify_mode, ssl_context.check_hostname, server_hostname))
            return self

        def get_extra_info(self, info):
            return None

    async def connect_tcp(self, host, port, **kwargs):
        connections.append((host, port))
        return SyntheticSocket()

    monkeypatch.setattr(AnyIOBackend, 'connect_tcp', connect_tcp)
    assert send() is None
    assert connections == [('api.resend.com', 443)]
    assert handshakes == [(ssl.CERT_REQUIRED, True, 'api.resend.com')]
    assert b''.join(writes).startswith(b'POST /emails HTTP/1.1\r\n')
    assert closed
