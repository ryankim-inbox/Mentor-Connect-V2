from fastapi import Depends
from security import require_verified_user
from fastapi import APIRouter, Request, HTTPException, Response, Query
from pydantic import BaseModel, ConfigDict, Field, PositiveInt
from psycopg2.errors import ForeignKeyViolation
from typing import Annotated, Literal, Optional
from security import require_admin
from db import db

router = APIRouter(dependencies=[Depends(require_verified_user)])

class CreateReportBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reportedUserId: PositiveInt
    reason: Literal["spam", "harassment", "inappropriate", "fake_account", "other"]
    description: Optional[str] = Field(default=None, max_length=2000)

class BlockUserBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    blockedUserId: PositiveInt

@router.post("/reports", status_code=201)
def create_report(body: CreateReportBody, request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if body.reportedUserId == user_id:
        raise HTTPException(status_code=400, detail="Cannot report yourself")

    try:
        with db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id FROM users WHERE id = %s", (body.reportedUserId,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="User not found")
            cur.execute(
                "INSERT INTO reports (reporter_id, reported_user_id, reason, description) VALUES (%s, %s, %s, %s)",
                (user_id, body.reportedUserId, body.reason, body.description),
            )
    except ForeignKeyViolation as exc:
        if exc.diag.constraint_name == "reports_reported_user_id_fkey":
            raise HTTPException(status_code=404, detail="User not found") from None
        raise
    return {"message": "Report submitted successfully"}

@router.get("/blocks")
def list_blocks(request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM blocks WHERE blocker_id = %s", (user_id,))
        blocks = cur.fetchall()
        result = []
        for block in blocks:
            cur.execute("SELECT name FROM users WHERE id = %s", (block["blocked_user_id"],))
            blocked_user = cur.fetchone()
            result.append({
                "id": block["id"],
                "blockedUserId": block["blocked_user_id"],
                "blockedUserName": blocked_user["name"] if blocked_user else "Unknown",
                "createdAt": block["created_at"].isoformat(),
            })
        return result

@router.post("/blocks", status_code=201)
def block_user(body: BlockUserBody, request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
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
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

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
    cur.execute('''SELECT r.*, a.name AS reporter_name,b.name AS reported_user_name
                   FROM reports r JOIN users a ON a.id=r.reporter_id JOIN users b ON b.id=r.reported_user_id
                   WHERE r.id=%s''',(report_id,))
    row=cur.fetchone()
    if not row:
        raise HTTPException(404,'Report not found')
    return {'id':row['id'],'reporterId':row['reporter_id'],'reporterName':row['reporter_name'],
            'reportedUserId':row['reported_user_id'],'reportedUserName':row['reported_user_name'],
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
