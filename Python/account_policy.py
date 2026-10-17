"""Trusted database markers for identities that cannot authenticate."""

SYNTHETIC_LOCK_PREFIX = '!mentor-connect-synthetic:'


def is_synthetic_locked(user):
    # This is a server-written password sentinel, never an email/name/client flag.
    return str(user.get('password_hash', '')).startswith(SYNTHETIC_LOCK_PREFIX)
