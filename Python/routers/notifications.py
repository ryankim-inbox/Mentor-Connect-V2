from fastapi import APIRouter, Depends, HTTPException, Request

from auto_match import ensure_table
from db import db
from security import require_verified_user

router = APIRouter(dependencies=[Depends(require_verified_user)])


def _user_id(request: Request) -> int:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user_id


@router.get("/notifications")
def list_notifications(request: Request):
    """Return the signed-in user's 50 newest notifications and unread count."""
    user_id = _user_id(request)
    with db() as conn:
        cur = conn.cursor()
        ensure_table(cur)
        cur.execute(
            """SELECT id, kind, request_id, message, created_at, read_at
               FROM notifications WHERE user_id = %s
               ORDER BY created_at DESC, id DESC LIMIT 50""",
            (user_id,),
        )
        rows = cur.fetchall()
        cur.execute(
            "SELECT count(*) AS n FROM notifications WHERE user_id = %s AND read_at IS NULL",
            (user_id,),
        )
        unread = cur.fetchone()["n"]
    return {
        "unreadCount": unread,
        "items": [
            {
                "id": r["id"],
                "kind": r["kind"],
                "requestId": r["request_id"],
                "message": r["message"],
                "createdAt": r["created_at"].isoformat(),
                "read": r["read_at"] is not None,
            }
            for r in rows
        ],
    }


@router.post("/notifications/read", status_code=204)
def mark_notifications_read(request: Request):
    user_id = _user_id(request)
    with db() as conn:
        cur = conn.cursor()
        ensure_table(cur)
        cur.execute(
            "UPDATE notifications SET read_at = now() WHERE user_id = %s AND read_at IS NULL",
            (user_id,),
        )
