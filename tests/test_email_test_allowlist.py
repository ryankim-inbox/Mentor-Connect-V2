"""The test signup exception is one server-selected mailbox, never authority."""
import json
from http.cookiejar import CookieJar
from urllib.request import HTTPCookieProcessor, build_opener

from pydantic import ValidationError
import pytest

from backend_support import api
import email_policy
from routers.auth import RegisterBody
from test_account_trust import execute, token_from


RECIPIENT = 'owner+test@example.com'


def registration(email=RECIPIENT, **changes):
    return {'email': email, 'name': 'Test owner', 'password': 'Password123!',
            'role': 'both', 'districtId': 1, **changes}


def configure(monkeypatch, enabled='true', recipient=RECIPIENT):
    for key, value in [('EMAIL_TEST_ALLOWLIST_ENABLED', enabled), ('EMAIL_TEST_RECIPIENT', recipient)]:
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)


@pytest.mark.parametrize(('value', 'expected'), [
    ('Owner+Test@Example.COM', RECIPIENT),
    ('First.Last@students.Example.EDU', 'first.last@students.example.edu'),
    ('a@b.co', 'a@b.co'),
    ('a' * 64 + '@example.com', 'a' * 64 + '@example.com'),
])
def test_mailbox_normalization_preserves_distinct_local_parts(value, expected):
    assert email_policy.normalize_mailbox(value) == expected


INVALID_MAILBOXES = [
    None, 7, '', 'missing-at.edu', '@example.edu', 'owner@',
    'owner@@example.edu', 'owner@example.edu@evil.com',
    ' owner@example.edu', 'owner@example.edu ', 'own er@example.edu',
    'owner@example.edu\n', 'owner\r\n@example.edu', 'owner\x00@example.edu',
    'owner\t@example.edu', 'owner\x7f@example.edu', 'owner\u00a0@example.edu',
    'Owner <owner@example.edu>', 'owner@example.edu,other@example.edu',
    'owner@example.edu;other@example.edu', '"owner"@example.edu',
    '.owner@example.edu', 'owner.@example.edu', 'own..er@example.edu',
    'owner@-example.edu', 'owner@example-.edu', 'owner@exam_ple.edu',
    'owner@example..edu', 'owner@example.edu.', 'owner@localhost',
    'owner@[127.0.0.1]', 'ownér@example.edu', 'owner@exämple.edu',
    '*@example.edu', 'owner@*.edu', 'a' * 65 + '@example.edu',
    'owner@' + 'a' * 64 + '.edu',
    'a' * 64 + '@' + '.'.join(['b' * 63] * 3 + ['com']),
]


@pytest.mark.parametrize('value', INVALID_MAILBOXES)
def test_mailbox_normalization_rejects_ambiguous_or_invalid_addresses(value):
    assert email_policy.normalize_mailbox(value) is None


@pytest.mark.parametrize(('enabled', 'recipient'), [
    (None, None), (None, RECIPIENT), ('false', RECIPIENT), ('TRUE', RECIPIENT),
    ('1', RECIPIENT), ('true ', RECIPIENT), ('true', None), ('true', ''),
    ('true', '*@example.com'), ('true', 'example.com'),
    ('true', 'owner@example.com,other@example.com'),
    ('true', 'Owner <owner@example.com>'), ('true', ' owner@example.com'),
    ('true', 'owner@example.com\n'),
])
def test_invalid_or_disabled_configuration_fails_closed(monkeypatch, enabled, recipient):
    configure(monkeypatch, enabled, recipient)
    assert email_policy.configured_test_recipient() is None
    with pytest.raises(ValidationError):
        RegisterBody(**registration())
    assert RegisterBody(**registration('Student@School.EDU')).email == 'student@school.edu'


def test_exact_case_normalized_configured_mailbox_is_eligible(monkeypatch):
    configure(monkeypatch, recipient='Owner+Test@Example.COM')
    assert email_policy.configured_test_recipient() == RECIPIENT
    assert RegisterBody(**registration('OWNER+TEST@example.COM')).email == RECIPIENT
    assert RegisterBody(**registration('Student@School.EDU')).email == 'student@school.edu'


@pytest.mark.parametrize('email', [
    'other@example.com', 'owner@example.com', 'owner+other@example.com',
    'owner.test@example.com', 'o.wner+test@example.com',
    'owner+test@sub.example.com', 'owner+test@example.com.evil.test',
])
def test_exception_never_expands_to_aliases_or_other_recipients(monkeypatch, email):
    configure(monkeypatch)
    with pytest.raises(ValidationError) as error:
        RegisterBody(**registration(email))
    assert RECIPIENT not in json.dumps(error.value.errors(include_input=False, include_context=False))


@pytest.mark.parametrize('email', [value for value in INVALID_MAILBOXES if isinstance(value, str)])
def test_school_suffix_never_bypasses_mailbox_validation(monkeypatch, email):
    configure(monkeypatch)
    with pytest.raises(ValidationError):
        RegisterBody(**registration(email))


@pytest.mark.parametrize('changes', [
    {'role': 'admin'}, {'isAdmin': True}, {'isVerified': True},
    {'email_verified_at': '2026-01-01'}, {'EMAIL_TEST_ALLOWLIST_ENABLED': 'true'},
    {'EMAIL_TEST_RECIPIENT': 'attacker@example.com'}, {'allowlist': ['attacker@example.com']},
    {'testRecipient': 'attacker@example.com'},
])
def test_allowlist_cannot_be_selected_or_grant_privilege_in_body(monkeypatch, changes):
    configure(monkeypatch)
    with pytest.raises(ValidationError):
        RegisterBody(**registration(**changes))


@pytest.mark.parametrize('entrypoint', ['backend', 'gateway'])
def test_exact_test_signup_still_requires_ownership_and_never_grants_admin(
        request, backend_database, monkeypatch, tmp_path, entrypoint):
    configure(monkeypatch, recipient='Owner+Test@Example.COM')
    monkeypatch.setenv('EMAIL_DELIVERY_MODE', 'development-file')
    monkeypatch.setenv('EMAIL_DEV_OUTBOX_DIR', str(tmp_path / 'outbox'))
    monkeypatch.setenv('APP_ORIGIN', 'http://127.0.0.1:14200')
    if entrypoint == 'backend':
        server = request.getfixturevalue('backend_server')()
        base = server.__enter__()
        request.addfinalizer(lambda: server.__exit__(None, None, None))
    else:
        base = request.getfixturevalue('gateway_server')
    client = build_opener(HTTPCookieProcessor(CookieJar()))
    status, result = api(client, base, 'POST', '/api/auth/register', registration('OWNER+TEST@example.COM'))
    assert status == 201, result
    user = result['user']
    assert user['email'] == RECIPIENT
    assert user['isVerified'] is False and user['isAdmin'] is False
    user_id = user['id']
    assert execute(backend_database, 'SELECT email_verified_at,is_verified,is_admin FROM users WHERE id=%s', (user_id,)) == [(None, False, False)]
    assert execute(backend_database, 'SELECT count(*) FROM email_verification_tokens WHERE user_id=%s', (user_id,)) == [(0,)]
    assert api(client, base, 'GET', '/api/auth/me')[0] == 200
    assert api(client, base, 'GET', '/api/mentors')[0] == 403
    assert api(client, base, 'GET', '/api/admin/reports')[0] == 403
    status, response = api(client, base, 'POST', '/api/auth/verification/request')
    assert status == 202, response
    assert 'accepted for delivery' in response['message']
    assert api(client, base, 'GET', '/api/mentors')[0] == 403
    status, own = api(client, base, 'POST', '/api/auth/verification/confirm', {'token': token_from(tmp_path / 'outbox')})
    assert status == 200 and own['isVerified'] is True and own['isAdmin'] is False
    assert api(client, base, 'GET', '/api/mentors')[0] == 200
    assert api(client, base, 'GET', '/api/admin/reports')[0] == 403
    assert execute(backend_database, 'SELECT email_verified_at IS NOT NULL,is_verified,is_admin FROM users WHERE id=%s', (user_id,)) == [(True, True, False)]
    # Wrong addresses receive only generic eligibility errors, never the configured address.
    status, error = api(build_opener(), base, 'POST', '/api/auth/register', registration('other@example.com'))
    assert status == (400 if entrypoint == 'gateway' else 422)
    assert RECIPIENT not in json.dumps(error).lower()
