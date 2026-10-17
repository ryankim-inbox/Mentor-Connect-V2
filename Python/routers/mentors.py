"""Bounded discovery of mentors with current member access in the viewer's district."""
from typing import Annotated
from fastapi import APIRouter, Depends, Query
from db import db
from security import require_member_user, public_user
from member_access import enabled_test_members
from account_policy import SYNTHETIC_LOCK_PREFIX

router = APIRouter()


@router.get('/mentors')
def list_mentors(limit: Annotated[int,Query(ge=1,le=50)] = 50,
                 beforeId: Annotated[int | None,Query(ge=1,le=2147483647)] = None,
                 user=Depends(require_member_user)):
    with db() as conn:
        cur = conn.cursor()
        test_mentor_id = next((id for id, role in enabled_test_members().items() if role == 'mentor'), None)
        cur.execute('''SELECT u.*, d.name AS district_name FROM users u
                       JOIN districts d ON d.id=u.district_id
                       WHERE u.role IN ('mentor','both') AND (u.email_verified_at IS NOT NULL
                         OR (u.id=%s AND u.role='mentor' AND u.is_admin=false))
                       AND u.password_hash NOT LIKE %s
                       AND u.district_id=%s AND u.id<>%s AND (%s IS NULL OR u.id<%s)
                       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
                         (b.blocker_id=%s AND b.blocked_user_id=u.id) OR
                         (b.blocker_id=u.id AND b.blocked_user_id=%s))
                       ORDER BY u.id DESC LIMIT %s''',
                    (test_mentor_id,SYNTHETIC_LOCK_PREFIX+'%',user['district_id'],user['id'],beforeId,beforeId,user['id'],user['id'],limit))
        return [public_user(u) for u in cur.fetchall()]
