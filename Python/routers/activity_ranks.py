"""Authenticated, bounded public activity badges for eligible student profiles."""
from fastapi import APIRouter, Depends, HTTPException, Request

from activity_ranks import get_activity_rank
from db import db
from security import require_member_user


router = APIRouter(dependencies=[Depends(require_member_user)])


@router.get("/users/{user_id}/activity-rank")
def get_user_activity_rank(user_id: int, request: Request):
    viewer = require_member_user(request)
    if not 1 <= user_id <= 2147483647:
        raise HTTPException(404, "User not found")
    if viewer['id'] != user_id:
        with db() as conn, conn.cursor() as cur:
            cur.execute(
                """SELECT 1 FROM blocks
                   WHERE (blocker_id=%s AND blocked_user_id=%s)
                      OR (blocker_id=%s AND blocked_user_id=%s) LIMIT 1""",
                (viewer['id'], user_id, user_id, viewer['id']),
            )
            if cur.fetchone():
                raise HTTPException(404, "User not found")
    activity = get_activity_rank(user_id)
    if activity is None:
        raise HTTPException(404, "User not found")
    return activity
