"""Bounded safe discovery of verified mentors in the viewer's district."""
from typing import Annotated
from fastapi import APIRouter, Depends, Query
from db import db
from security import require_verified_user, public_user

router = APIRouter()


@router.get('/mentors')
def list_mentors(limit: Annotated[int,Query(ge=1,le=50)] = 50,
                 beforeId: Annotated[int | None,Query(ge=1,le=2147483647)] = None,
                 user=Depends(require_verified_user)):
    with db() as conn:
        cur = conn.cursor()
        cur.execute('''SELECT u.*, d.name AS district_name FROM users u
                       JOIN districts d ON d.id=u.district_id
                       WHERE u.role IN ('mentor','both') AND u.email_verified_at IS NOT NULL
                       AND u.district_id=%s AND u.id<>%s AND (%s IS NULL OR u.id<%s)
                       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
                         (b.blocker_id=%s AND b.blocked_user_id=u.id) OR
                         (b.blocker_id=u.id AND b.blocked_user_id=%s))
                       ORDER BY u.id DESC LIMIT %s''',
                    (user['district_id'],user['id'],beforeId,beforeId,user['id'],user['id'],limit))
        return [public_user(u) for u in cur.fetchall()]
