"""Conservative mailbox syntax and the private, exact test delivery recipient."""
import os
import re


# Bare ASCII dot-atoms only; wildcard-looking mailboxes are intentionally excluded.
_LOCAL_PART = re.compile(r"[A-Za-z0-9!#$%&'+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'+/=?^_`{|}~-]+)*")
_DOMAIN_LABEL = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?")


def normalize_mailbox(value: object) -> str | None:
    """Validate one bare mailbox and lowercase it without alias or dot folding."""
    if not isinstance(value, str) or not value.isascii() or len(value) > 254 or value.count('@') != 1:
        return None
    local, domain = value.split('@')
    if len(local) > 64 or not _LOCAL_PART.fullmatch(local):
        return None
    labels = domain.split('.')
    if len(labels) < 2 or not all(_DOMAIN_LABEL.fullmatch(label) for label in labels):
        return None
    return value.lower()


def configured_test_recipient() -> str | None:
    """Fail closed unless the server explicitly enables one valid test mailbox."""
    if os.environ.get('EMAIL_TEST_ALLOWLIST_ENABLED') != 'true':
        return None
    return normalize_mailbox(os.environ.get('EMAIL_TEST_RECIPIENT'))
