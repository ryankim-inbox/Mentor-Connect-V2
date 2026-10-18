"""Database-backed authority: signed session attributes are never privilege grants."""
from fastapi import HTTPException, Request
from db import db
from member_access import has_member_access, has_admin_access, has_student_access
from account_policy import is_synthetic_locked, is_demo_user


def current_user(request):
    user_id = request.session.get('user_id')
    if not isinstance(user_id, int) or isinstance(user_id, bool):
        raise HTTPException(401, 'Not authenticated')
    with db() as conn:
        cur = conn.cursor()
        cur.execute('SELECT u.*, d.name AS district_name FROM users u LEFT JOIN districts d ON d.id=u.district_id WHERE u.id=%s', (user_id,))
        user = cur.fetchone()
    if not user or is_synthetic_locked(user):
        raise HTTPException(401, 'Not authenticated')
    return user


def require_user(request: Request):
    return current_user(request)


def verified(user):
    if user['email_verified_at'] is None:
        raise HTTPException(403, 'Email verification required')
    return user


def require_verified_user(request: Request):
    return verified(current_user(request))


def member(user):
    if not has_member_access(user):
        raise HTTPException(403, 'Email verification required')
    return user


def require_member_user(request: Request):
    return member(current_user(request))


def require_student_user(request: Request):
    user = member(current_user(request))
    if not has_student_access(user):
        raise HTTPException(403, 'Student access required')
    return user


def require_admin(request: Request):
    user = require_verified_user(request)
    if not has_admin_access(user):
        raise HTTPException(403, 'Administrator access required')
    return user


def public_user(user):
    return {'id':user['id'], 'name':user['name'], 'role':user['role'],
            'subjects':user['subjects'] or [], 'districtId':user['district_id'],
            'districtName':user['district_name'], 'bio':user['bio'], 'isDemo':is_demo_user(user)}
