from fastapi import Depends
from security import require_member_user, require_student_user
from fastapi import APIRouter, Request, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, PositiveInt
from psycopg2.errors import ForeignKeyViolation
from typing import Annotated, Literal, Optional
from security import require_admin
from db import db
from account_policy import is_demo_user, is_demo_request

router = APIRouter(dependencies=[Depends(require_member_user)])

class CreateReportBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reportedUserId: PositiveInt
    requestId: PositiveInt | None = None
    reason: Literal["spam", "harassment", "inappropriate", "fake_account", "other"]
    description: Optional[str] = Field(default=None, max_length=2000)

class BlockUserBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    blockedUserId: PositiveInt

@router.post("/reports", status_code=201)
def create_report(body: CreateReportBody, request: Request):
    user_id = require_student_user(request)["id"]
    if body.reportedUserId == user_id:
        raise HTTPException(status_code=400, detail="Cannot report yourself")

    try:
        with db() as conn:
            cur = conn.cursor()
            # Report writes use their own advisory-lock namespace. Serializing
            # each reporter also covers the first submission before a row exists.
            cur.execute("SELECT pg_advisory_xact_lock(%s, %s)", (0x525054, user_id))
            target_type = "profile"
            request_title = None
            if body.requestId is not None:
                cur.execute("SELECT author_id,title FROM requests WHERE id=%s FOR SHARE", (body.requestId,))
                reported_request = cur.fetchone()
                if not reported_request:
                    raise HTTPException(status_code=404, detail="Request not found")
                if reported_request["author_id"] != body.reportedUserId:
                    raise HTTPException(status_code=400, detail="Reported user must be the request author")
                target_type = "request"
                # Historical titles can exceed today's byte limit. Retain a
                # valid UTF-8 prefix without modifying the original request.
                request_title = reported_request["title"].encode("utf-8")[:200].decode("utf-8", errors="ignore")
            cur.execute("SELECT id FROM users WHERE id = %s", (body.reportedUserId,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="User not found")
            cur.execute(
                """SELECT 1 FROM blocks WHERE
                   (blocker_id=%s AND blocked_user_id=%s) OR
                   (blocker_id=%s AND blocked_user_id=%s) LIMIT 1""",
                (user_id, body.reportedUserId, body.reportedUserId, user_id),
            )
            if cur.fetchone():
                raise HTTPException(status_code=403, detail="Blocked relationship")
            cur.execute(
                """SELECT id FROM reports WHERE reporter_id=%s AND reported_user_id=%s
                   AND target_type=%s AND request_id IS NOT DISTINCT FROM %s
                   AND status IN ('open','reviewing') ORDER BY id LIMIT 1 FOR UPDATE""",
                (user_id, body.reportedUserId, target_type, body.requestId),
            )
            if not cur.fetchone():
                cur.execute(
                    """INSERT INTO reports (reporter_id, reported_user_id, reason, description,
                           target_type, request_id, request_title)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (user_id, body.reportedUserId, body.reason, body.description,
                     target_type, body.requestId, request_title),
                )
    except ForeignKeyViolation as exc:
        if exc.diag.constraint_name == "reports_reported_user_id_fkey":
            raise HTTPException(status_code=404, detail="User not found") from None
        if exc.diag.constraint_name == "reports_request_id_fkey":
            raise HTTPException(status_code=404, detail="Request not found") from None
        raise
    return {"message": "Report submitted successfully"}

@router.get("/blocks")
def list_blocks(request: Request):
    user_id = require_student_user(request)["id"]

    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM blocks WHERE blocker_id = %s", (user_id,))
        blocks = cur.fetchall()
        result = []
        for block in blocks:
            cur.execute("SELECT name, password_hash FROM users WHERE id = %s", (block["blocked_user_id"],))
            blocked_user = cur.fetchone()
            result.append({
                "id": block["id"],
                "blockedUserId": block["blocked_user_id"],
                "blockedUserName": blocked_user["name"] if blocked_user else "Unknown",
                "isDemo": is_demo_user(blocked_user),
                "createdAt": block["created_at"].isoformat(),
            })
        return result

@router.post("/blocks", status_code=201)
def block_user(body: BlockUserBody, request: Request):
    user_id = require_student_user(request)["id"]
    if body.blockedUserId == user_id:
        raise HTTPException(status_code=400, detail="Cannot block yourself")

    try:
        with db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id FROM users WHERE id = %s", (body.blockedUserId,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="User not found")
            cur.execute(
                "SELECT id FROM blocks WHERE blocker_id = %s AND blocked_user_id = %s",
                (user_id, body.blockedUserId),
            )
            if cur.fetchone():
                return {"message": "Already blocked"}
            cur.execute(
                "INSERT INTO blocks (blocker_id, blocked_user_id) VALUES (%s, %s)",
                (user_id, body.blockedUserId),
            )
    except ForeignKeyViolation as exc:
        if exc.diag.constraint_name == "blocks_blocked_user_id_fkey":
            raise HTTPException(status_code=404, detail="User not found") from None
        raise
    return {"message": "User blocked successfully"}

@router.delete("/blocks/{blocked_user_id}", status_code=204)
def unblock_user(blocked_user_id: PositiveInt, request: Request):
    user_id = require_student_user(request)["id"]

    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM blocks WHERE blocker_id = %s AND blocked_user_id = %s",
            (user_id, blocked_user_id),
        )


class ModerateReportBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: Literal['open','reviewing','resolved','dismissed']
    note: str | None = Field(
        default=None, max_length=2000,
        description='Omit to preserve the saved note; null clears it; a string replaces it.',
    )


def _report(cur, report_id):
    cur.execute('''SELECT r.*, a.name AS reporter_name,b.name AS reported_user_name,
                          a.password_hash AS reporter_password_hash,b.password_hash AS reported_password_hash,
                          q.request AS request_key,qa.password_hash AS request_author_password_hash
                   FROM reports r JOIN users a ON a.id=r.reporter_id JOIN users b ON b.id=r.reported_user_id
                   LEFT JOIN requests q ON q.id=r.request_id LEFT JOIN users qa ON qa.id=q.author_id
                   WHERE r.id=%s''',(report_id,))
    row=cur.fetchone()
    if not row:
        raise HTTPException(404,'Report not found')
    return {'id':row['id'],'reporterId':row['reporter_id'],'reporterName':row['reporter_name'],
            'reporterIsDemo':is_demo_user({'password_hash':row['reporter_password_hash']}),
            'reportedUserId':row['reported_user_id'],'reportedUserName':row['reported_user_name'],
            'reportedUserIsDemo':is_demo_user({'password_hash':row['reported_password_hash']}),
            'targetType':row['target_type'],'requestId':row['request_id'],'requestTitle':row['request_title'],
            'requestIsDemo':is_demo_request({'request':row['request_key']},
                                           {'password_hash':row['request_author_password_hash']}),
            'reason':row['reason'],'description':row['description'],'status':row['status'],
            'note':row['note'],'reviewedBy':row['reviewed_by'],
            'reviewedAt':row['reviewed_at'].isoformat() if row['reviewed_at'] else None,
            'createdAt':row['created_at'].isoformat()}


@router.get('/admin/reports',dependencies=[Depends(require_admin)])
def list_admin_reports(status: Literal['open','reviewing','resolved','dismissed'] | None = None,
                       limit: Annotated[int,Query(ge=1,le=50)] = 50,
                       beforeId: Annotated[int | None,Query(ge=1,le=2147483647)] = None):
    with db() as conn:
        cur=conn.cursor()
        cur.execute('SELECT id FROM reports WHERE (%s IS NULL OR status=%s) AND (%s IS NULL OR id<%s) ORDER BY id DESC LIMIT %s',(status,status,beforeId,beforeId,limit))
        return [_report(cur,row['id']) for row in cur.fetchall()]


@router.patch('/admin/reports/{report_id}')
def moderate_report(report_id: PositiveInt,body: ModerateReportBody,user=Depends(require_admin)):
    with db() as conn:
        cur=conn.cursor()
        cur.execute('''UPDATE reports
                       SET status=%s,note=CASE WHEN %s THEN %s ELSE note END,
                           reviewed_by=%s,reviewed_at=now()
                       WHERE id=%s''',
                    (body.status,'note' in body.model_fields_set,body.note,user['id'],report_id))
        return _report(cur,report_id)
