"""Trusted database markers for identities that cannot authenticate."""

SYNTHETIC_LOCK_PREFIX = '!mentor-connect-synthetic:'
DEMO_BATCH = 'mc-synthetic-v1-983-782'
DEMO_PASSWORD_LOCK = f'{SYNTHETIC_LOCK_PREFIX}v1:{DEMO_BATCH}'
DEMO_REQUEST_KEYS = frozenset(f'{DEMO_BATCH}:question:{number:04d}' for number in range(1, 783))


def is_synthetic_locked(user):
    # This is a server-written password sentinel, never an email/name/client flag.
    return str(user.get('password_hash', '')).startswith(SYNTHETIC_LOCK_PREFIX)


def is_demo_user(user):
    """Identify the approved demo batch from its exact server-written lock."""
    return bool(user and user.get('password_hash') == DEMO_PASSWORD_LOCK)


def is_demo_request(request, author):
    """Both canonical authorship and the reserved seed key must agree."""
    return is_demo_user(author) and request.get('request') in DEMO_REQUEST_KEYS


def with_demo_marker(row):
    """Project a selected teaching row without its internal identity sentinel."""
    if row is None:
        return None
    return {**{key: value for key, value in row.items() if key != 'password_hash'},
            'isDemo': is_demo_user(row)}
