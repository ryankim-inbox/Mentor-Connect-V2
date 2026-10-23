from datetime import datetime
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from db import db
from security import require_student_user
from request_access import can_access_request, request_access_sql

router = APIRouter()
SafeId = Annotated[int, Field(strict=True, ge=1, le=9007199254740991)]


class NotificationItem(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: SafeId
    kind: Literal['request_match', 'request_match_summary', 'request_accepted']
    requestId: SafeId | None
    message: str = Field(min_length=1, max_length=1000)
    createdAt: datetime
    read: bool


class NotificationsResponse(BaseModel):
    model_config = ConfigDict(extra='forbid')
    unreadCount: int = Field(strict=True, ge=0, le=9007199254740991)
    items: list[NotificationItem] = Field(max_length=50)


class NotificationReadBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ids: list[SafeId] = Field(strict=True, min_length=1, max_length=50)

    @field_validator('ids')
    @classmethod
    def unique_ids(cls, value):
        if len(set(value)) != len(value):
            raise ValueError('Notification IDs must be unique')
        return value


def notify_request_accepted(cur, request_row, application_id, participants):
    """Share the acceptance transaction and dedupe retries per application."""
    for participant in participants:
        if can_access_request(request_row, participant):
            cur.execute(
                """INSERT INTO notifications(user_id,kind,request_id,message,event_key)
                   VALUES (%s,'request_accepted',%s,%s,%s) ON CONFLICT DO NOTHING""",
                (participant['id'], request_row['id'],
                 f"Your connection is confirmed: {request_row['title']}"[:1000],
                 f"request_accepted:application:{application_id}"),
            )


def visible_notifications_sql(user):
    audience_clause, audience_params = request_access_sql(user)
    return (f"""n.user_id = %s AND (n.request_id IS NULL OR EXISTS (
                  SELECT 1 FROM requests r WHERE r.id=n.request_id AND {audience_clause}
                  AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
                    (b.blocker_id=%s AND b.blocked_user_id=r.author_id) OR
                    (b.blocker_id=r.author_id AND b.blocked_user_id=%s))))""",
            [user['id'], *audience_params, user['id'], user['id']])


@router.get("/notifications", response_model=NotificationsResponse)
def list_notifications(user=Depends(require_student_user)):
    """Return the signed-in user's 50 newest notifications and unread count."""
    visible_clause, params = visible_notifications_sql(user)
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""SELECT n.id, n.kind, n.request_id, n.message, n.created_at, n.read_at
                FROM notifications n WHERE {visible_clause}
                ORDER BY n.created_at DESC, n.id DESC LIMIT 50""",
            params,
        )
        rows = cur.fetchall()
        cur.execute(
            f"SELECT count(*) AS n FROM notifications n WHERE {visible_clause} AND n.read_at IS NULL",
            params,
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
def mark_notifications_read(body: NotificationReadBody | None = None, user=Depends(require_student_user)):
    visible_clause, params = visible_notifications_sql(user)
    if body is not None:
        visible_clause += ' AND n.id = ANY(%s)'
        params.append(body.ids)
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE notifications n SET read_at = now() WHERE {visible_clause} AND n.read_at IS NULL",
            params,
        )
    return Response(status_code=204)
