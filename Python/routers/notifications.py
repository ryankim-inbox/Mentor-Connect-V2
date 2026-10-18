from datetime import datetime
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from db import db
from security import require_student_user

router = APIRouter()
SafeId = Annotated[int, Field(strict=True, ge=1, le=9007199254740991)]


class NotificationItem(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: SafeId
    kind: Literal['request_match', 'request_match_summary']
    requestId: SafeId | None
    message: str = Field(min_length=1, max_length=1000)
    createdAt: datetime
    read: bool


class NotificationsResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    unreadCount: int = Field(strict=True, ge=0, le=9007199254740991)
    items: list[NotificationItem] = Field(max_length=50)


@router.get("/notifications", response_model=NotificationsResponse)
def list_notifications(user=Depends(require_student_user)):
    """Return the signed-in user's 50 newest notifications and unread count."""
    user_id = user['id']
    with db() as conn:
        cur = conn.cursor()
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


@router.post("/notifications/read", status_code=204, response_class=Response)
def mark_notifications_read(user=Depends(require_student_user)):
    user_id = user['id']
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE notifications SET read_at = now() WHERE user_id = %s AND read_at IS NULL",
            (user_id,),
        )
    return Response(status_code=204)
