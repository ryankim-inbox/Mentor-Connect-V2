"""Explicit local-only delivery. No network mail provider or token logging."""
import json
import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit


class DeliveryUnavailable(Exception):
    pass


def deliver_verification(email, token):
    if os.environ.get('EMAIL_DELIVERY_MODE', 'disabled') != 'development-file' or os.environ.get('NODE_ENV') == 'production':
        raise DeliveryUnavailable('Email delivery disabled')
    origin = os.environ.get('APP_ORIGIN', '')
    parsed = urlsplit(origin)
    if parsed.scheme not in ('http','https') or not parsed.netloc or parsed.username or parsed.password or parsed.path not in ('','/') or parsed.query or parsed.fragment:
        raise DeliveryUnavailable('Email delivery configuration invalid')
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
            json.dump({'to':email, 'confirmationUrl':origin.rstrip('/')+'/verify-email#token='+token},handle)
    except OSError:
        raise DeliveryUnavailable('Email delivery failed') from None
