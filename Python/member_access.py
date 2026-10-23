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
            and (user['email_verified_at'] is not None or _has_demo_admin_exception(user))
            and user['is_admin'] is True
            and user['id'] not in configured_test_members())


def _has_demo_admin_exception(user):
    """Disabled by default; pinned identity and trusted server config, never proof."""
    origin = 'https://mentor-connect-test.onrender.com'
    return (user['id'] == 991
            and user['email'] == 'admin@test.edu'
            and os.environ.get('DEMO_ADMIN_USER_ID') == '991'
            and os.environ.get('APP_ORIGIN') == origin
            and os.environ.get('GATEWAY_PUBLIC_ORIGIN') == origin)


def has_student_access(user):
    return (user['is_admin'] is False
            and user['role'] in ('mentor', 'mentee', 'both')
            and has_member_access(user))
