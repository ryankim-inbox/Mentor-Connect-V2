"""Member access does not claim mailbox ownership or confer administrator access."""
from datetime import datetime, timezone

import pytest

from member_access import has_admin_access, has_member_access, has_student_access
from routers.auth import format_user
from test_test_member_access import row


@pytest.mark.parametrize('role', ['mentor', 'mentee', 'both'])
def test_unverified_registered_roles_have_member_access_without_test_configuration(monkeypatch, role):
    for key in ('TEST_MEMBER_ACCESS_ENABLED', 'TEST_MEMBER_MENTOR_ID', 'TEST_MEMBER_MENTEE_ID'):
        monkeypatch.delenv(key, raising=False)
    user = row(951, role)
    before = dict(user)
    public = format_user(user, 'Synthetic district')
    assert public['hasMemberAccess'] is True
    assert has_student_access(user) is True
    assert public['isVerified'] is False
    assert public['isAdmin'] is False
    assert user == before


def test_admin_still_requires_actual_ownership_and_reserved_ids_stay_excluded(monkeypatch):
    monkeypatch.setenv('TEST_MEMBER_MENTOR_ID', '501')
    monkeypatch.setenv('TEST_MEMBER_MENTEE_ID', '1')
    user = row(951, 'mentor')
    user['is_admin'] = True
    assert not has_member_access(user)
    assert not has_admin_access(user)
    assert not has_student_access(user)
    user['email_verified_at'] = datetime.now(timezone.utc)
    assert has_member_access(user)
    assert has_admin_access(user)
    assert not has_student_access(user)
    user['id'] = 501
    assert not has_member_access(user)
    assert not has_admin_access(user)


def test_locked_synthetic_account_never_gains_member_access():
    user = row(951, 'mentor', password_hash='!mentor-connect-synthetic:policy-fixture')
    assert not has_member_access(user)
    assert not has_student_access(user)
    assert not has_admin_access(user)
