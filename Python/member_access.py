"""Server-owned member access, independent of mailbox ownership.

Ownership is persisted separately. This policy never writes verification state,
accepts a client claim, or turns a student role into an administrator.
"""
import os
import re
from account_policy import is_synthetic_locked


def configured_test_members():
    """Reserve exactly two distinct account IDs, including when access is disabled."""
    values = [os.environ.get(key, '') for key in ('TEST_MEMBER_MENTOR_ID', 'TEST_MEMBER_MENTEE_ID')]
    if not all(re.fullmatch(r'[1-9][0-9]{0,9}', value) for value in values):
        return {}
    mentor, mentee = map(int, values)
    if mentor == mentee or max(mentor, mentee) > 2147483647:
        return {}
    return {mentor: 'mentor', mentee: 'mentee'}


def has_member_access(user):
    if is_synthetic_locked(user):
        return False
    return user['is_admin'] is False or has_admin_access(user)


def has_admin_access(user):
    # Reserved test IDs cannot acquire admin through role edits or an accidental
    # DB flag, even after actual verification or disabling the member exception.
    return (not is_synthetic_locked(user)
            and user['email_verified_at'] is not None
            and user['is_admin'] is True
            and user['id'] not in configured_test_members())


def has_student_access(user):
    return (user['is_admin'] is False
            and user['role'] in ('mentor', 'mentee', 'both')
            and has_member_access(user))
