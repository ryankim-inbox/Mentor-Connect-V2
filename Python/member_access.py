"""Server-only, two-account exception for the fixed test deployment.

Ownership is persisted separately. This policy never writes verification state,
accepts a client claim, or turns a student role into an administrator.
"""
import os
import re
from account_policy import is_synthetic_locked


TEST_ORIGIN = 'https://mentor-connect-test.onrender.com'


def configured_test_members():
    """Reserve exactly two distinct account IDs, including when access is disabled."""
    values = [os.environ.get(key, '') for key in ('TEST_MEMBER_MENTOR_ID', 'TEST_MEMBER_MENTEE_ID')]
    if not all(re.fullmatch(r'[1-9][0-9]{0,9}', value) for value in values):
        return {}
    mentor, mentee = map(int, values)
    if mentor == mentee or max(mentor, mentee) > 2147483647:
        return {}
    return {mentor: 'mentor', mentee: 'mentee'}


def enabled_test_members():
    """No local, staging, suffix, case-folded, or trailing-slash origin aliases."""
    if (os.environ.get('TEST_MEMBER_ACCESS_ENABLED') != 'true'
            or os.environ.get('APP_ORIGIN') != TEST_ORIGIN
            or os.environ.get('GATEWAY_PUBLIC_ORIGIN') != TEST_ORIGIN):
        return {}
    return configured_test_members()


def has_member_access(user):
    if is_synthetic_locked(user):
        return False
    if user['email_verified_at'] is not None:
        return user['is_admin'] is False or has_admin_access(user)
    return (user['is_admin'] is False
            and enabled_test_members().get(user['id']) == user['role'])


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
