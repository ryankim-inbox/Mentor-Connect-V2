"""Explicit local delivery or one-recipient Resend testing; never log mail secrets."""
import asyncio
import json
import os
import re
import secrets
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
from anyio import from_thread


class DeliveryUnavailable(Exception):
    pass


_SEND_DEADLINE_SECONDS = 3.0
_MAX_RESPONSE_BYTES = 16 * 1024
_RESEND_ENDPOINT = 'https://api.resend.com/emails'


def _verification_link(token, *, network):
    origin = os.environ.get('APP_ORIGIN', '')
    try:
        if (not origin or len(origin) > 2048 or not origin.isascii()
                or re.search(r'[\s\\?#\x00-\x1f\x7f]', origin)):
            raise ValueError()
        parsed = urlsplit(origin)
        if (parsed.scheme not in (('https',) if network else ('http', 'https'))
                or not parsed.hostname or parsed.username is not None or parsed.password is not None
                or parsed.path not in ('', '/') or parsed.query or parsed.fragment
                or not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?', parsed.hostname)
                or '..' in parsed.hostname or (parsed.port is not None and not 1 <= parsed.port <= 65535)):
            raise ValueError()
        if network and origin.rstrip('/') != os.environ.get('GATEWAY_PUBLIC_ORIGIN', '').rstrip('/'):
            raise ValueError()
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43,128}', token):
            raise ValueError()
    except (ValueError, TypeError):
        raise DeliveryUnavailable('Email delivery configuration invalid') from None
    return origin.rstrip('/') + '/verify-email#token=' + token


def _new_resend_client():
    # Explicit transport settings also prevent TLS/proxy environment inheritance.
    return httpx.AsyncClient(
        transport=httpx.AsyncHTTPTransport(verify=True, trust_env=False, retries=0),
        trust_env=False, follow_redirects=False,
        timeout=httpx.Timeout(1.0, pool=0.25),
    )


async def _send_resend(api_key, payload):
    # Includes connection, sending and the entire streamed response, not just inactivity.
    async with asyncio.timeout(_SEND_DEADLINE_SECONDS):
        async with _new_resend_client() as client:
            async with client.stream('POST', _RESEND_ENDPOINT, json=payload, headers={
                'Authorization': 'Bearer ' + api_key,
                'User-Agent': 'Mentor-Connect/verification',
                'Accept': 'application/json',
                'Accept-Encoding': 'identity',
                'Idempotency-Key': str(uuid4()),
            }) as response:
                if (response.status_code != 200
                        or response.headers.get('content-encoding', 'identity').lower() != 'identity'
                        or response.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json'):
                    raise DeliveryUnavailable('Email delivery unavailable')
                length = response.headers.get('content-length')
                if length is not None and (not length.isdecimal() or int(length) > _MAX_RESPONSE_BYTES):
                    raise DeliveryUnavailable('Email delivery unavailable')
                body = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=1024):
                    if len(body) + len(chunk) > _MAX_RESPONSE_BYTES:
                        raise DeliveryUnavailable('Email delivery unavailable')
                    body.extend(chunk)
                accepted = json.loads(body)
                message_id = accepted.get('id') if isinstance(accepted, dict) else None
                if not isinstance(message_id, str) or str(UUID(message_id)) != message_id.lower():
                    raise DeliveryUnavailable('Email delivery unavailable')


def _deliver_resend_test(email, token):
    from email_policy import configured_test_recipient, normalize_mailbox

    recipient = configured_test_recipient()
    api_key = os.environ.get('RESEND_API_KEY', '')
    if (recipient is None or normalize_mailbox(email) != recipient
            or not 16 <= len(api_key) <= 512 or not api_key.isascii()
            or re.search(r'[\s\x00-\x1f\x7f]', api_key)):
        raise DeliveryUnavailable('Email delivery configuration invalid')
    link = _verification_link(token, network=True)
    payload = {
        'from': 'Mentor-Connect <onboarding@resend.dev>',
        'to': [recipient],
        'subject': 'Mentor-Connect email verification',
        'text': ('Confirm ownership of your Mentor-Connect email by opening this link while signed in to the same account:\n\n'
                 + link + '\n\nThis link expires in 30 minutes and works once. '
                 'If you did not request it, ignore this email.'),
    }
    try:
        # The route's AnyIO transaction worker waits for cancellable I/O on the app
        # loop. A per-call runner would wait for stalled DNS executor cleanup after
        # the deadline, holding the account transaction open in the meantime.
        from_thread.run(_send_resend, api_key, payload)
    except (httpx.HTTPError, TimeoutError, ValueError, TypeError, RecursionError, DeliveryUnavailable):
        # Neither provider content nor raw transport exceptions may cross the public boundary.
        raise DeliveryUnavailable('Email delivery unavailable') from None


def deliver_verification(email, token):
    mode = os.environ.get('EMAIL_DELIVERY_MODE', 'disabled')
    if mode == 'resend-test':
        return _deliver_resend_test(email, token)
    if mode != 'development-file' or os.environ.get('NODE_ENV') == 'production':
        raise DeliveryUnavailable('Email delivery disabled')
    link = _verification_link(token, network=False)
    directory = os.environ.get('EMAIL_DEV_OUTBOX_DIR')
    if not directory:
        raise DeliveryUnavailable('Email delivery configuration invalid')
    try:
        outbox = Path(directory)
        outbox.mkdir(mode=0o700, parents=True, exist_ok=True)
        if outbox.is_symlink():
            raise OSError('Unsafe outbox')
        outbox.chmod(0o700)
        path = outbox / (secrets.token_hex(16) + '.json')
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            json.dump({'to':email, 'confirmationUrl':link},handle)
    except OSError:
        raise DeliveryUnavailable('Email delivery failed') from None
