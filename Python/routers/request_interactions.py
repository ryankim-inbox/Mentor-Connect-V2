"""Consent-based connections and discussion; request locks serialize transitions."""
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from security import require_verified_user
from pydantic import BaseModel, ConfigDict, Field, PositiveInt, field_validator

from db import db
from request_events import record_match_event
from routers.chat import _require_user, _require_unblocked_pair
from routers.requests import build_request_response

router = APIRouter(dependencies=[Depends(require_verified_user)])
PageLimit = Annotated[int, Query(ge=1, le=50)]
BeforeId = Annotated[int | None, Query(ge=1, le=2147483647)]


class CommentBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str = Field(min_length=1, max_length=2000)
    parentId: PositiveInt | None = None
    clientCommentId: UUID

    @field_validator("body")
    @classmethod
    def clean_body(cls, value):
        if not value.strip():
            raise ValueError("Comment must contain text")
        return value.strip()


class ApplicationAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["accept", "reject", "cancel"]


def _request(cur, request_id, *, lock=False):
    cur.execute("SELECT * FROM requests WHERE id = %s" + (" FOR UPDATE" if lock else ""), (request_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Request not found")
    return row


def _application(cur, app_id):
    cur.execute("""SELECT a.*, u.name FROM request_applications a
                   JOIN users u ON u.id=a.applicant_id WHERE a.id=%s""", (app_id,))
    a = cur.fetchone()
    return {"id": a["id"], "requestId": a["request_id"], "applicantId": a["applicant_id"],
            "applicantName": a["name"], "status": a["status"],
            "createdAt": a["created_at"].isoformat(), "updatedAt": a["updated_at"].isoformat()}


@router.post("/requests/{request_id}/applications")
def apply_to_request(request_id: PositiveInt, request: Request):
    user_id = _require_user(request)
    with db() as conn:
        cur = conn.cursor()
        req = _request(cur, request_id, lock=True)
        if req["author_id"] == user_id:
            raise HTTPException(400, "Cannot apply to your own request")
        _require_unblocked_pair(cur, req["author_id"], user_id)
        cur.execute("SELECT * FROM request_applications WHERE request_id=%s AND applicant_id=%s", (request_id, user_id))
        existing = cur.fetchone()
        if existing and existing["status"] == "accepted" and req["status"] == "matched" and req["matched_user_id"] == user_id:
            return _application(cur, existing["id"])
        if req["status"] != "open":
            raise HTTPException(409, "Request is not open")
        if existing:
            if existing["status"] == "rejected":
                raise HTTPException(409, "This application was declined")
            if existing["status"] != "pending":
                cur.execute("UPDATE request_applications SET status='pending', updated_at=now() WHERE id=%s", (existing["id"],))
            app_id = existing["id"]
        else:
            cur.execute("INSERT INTO request_applications (request_id, applicant_id) VALUES (%s,%s) RETURNING id", (request_id, user_id))
            app_id = cur.fetchone()["id"]
        return _application(cur, app_id)


@router.get("/requests/{request_id}/applications")
def list_applications(request_id: PositiveInt, request: Request, limit: PageLimit = 50, beforeId: BeforeId = None):
    user_id = _require_user(request)
    with db() as conn:
        cur = conn.cursor()
        req = _request(cur, request_id)
        cur.execute("""SELECT id FROM request_applications WHERE request_id=%s
                       AND (%s OR applicant_id=%s) AND (%s IS NULL OR id < %s)
                       ORDER BY id DESC LIMIT %s""",
                    (request_id, req["author_id"] == user_id, user_id, beforeId, beforeId, limit))
        ids = cur.fetchall()
        return [_application(cur, a["id"]) for a in ids]


@router.patch("/requests/{request_id}/applications/{application_id}")
def act_on_application(request_id: PositiveInt, application_id: PositiveInt, body: ApplicationAction, request: Request):
    user_id = _require_user(request)
    with db() as conn:
        cur = conn.cursor()
        req = _request(cur, request_id, lock=True)
        cur.execute("SELECT * FROM request_applications WHERE id=%s AND request_id=%s", (application_id, request_id))
        app = cur.fetchone()
        if not app:
            raise HTTPException(404, "Application not found")
        allowed = app["applicant_id"] if body.action == "cancel" else req["author_id"]
        if user_id != allowed:
            raise HTTPException(403, "Forbidden")
        _require_unblocked_pair(cur, req["author_id"], app["applicant_id"])
        target = {"accept": "accepted", "reject": "rejected", "cancel": "cancelled"}[body.action]
        if app["status"] == target:
            return _application(cur, application_id)
        if app["status"] != "pending" or req["status"] != "open":
            raise HTTPException(409, "Application is no longer pending on an open request")
        if body.action == "accept":
            cur.execute("UPDATE requests SET status='matched', matched_user_id=%s, updated_at=now() WHERE id=%s RETURNING *",
                        (app["applicant_id"], request_id))
            record_match_event(cur, cur.fetchone())
            cur.execute("UPDATE request_applications SET status='rejected', updated_at=now() WHERE request_id=%s AND id<>%s AND status='pending'", (request_id, application_id))
        cur.execute("UPDATE request_applications SET status=%s, updated_at=now() WHERE id=%s", (target, application_id))
        return _application(cur, application_id)


def _comment(cur, comment_id):
    cur.execute("""SELECT c.*, u.name, p.author_id AS parent_author_id, pu.name AS parent_author_name
                   FROM request_comments c JOIN users u ON u.id=c.author_id
                   LEFT JOIN request_comments p ON p.id=c.parent_id LEFT JOIN users pu ON pu.id=p.author_id
                   WHERE c.id=%s""", (comment_id,))
    c = cur.fetchone()
    return {"id": c["id"], "requestId": c["request_id"], "authorId": c["author_id"], "authorName": c["name"],
            "parentId": c["parent_id"], "parentAuthorName": c["parent_author_name"],
            "body": "" if c["deleted_at"] else c["body"], "createdAt": c["created_at"].isoformat(),
            "updatedAt": c["updated_at"].isoformat() if c["updated_at"] else None,
            "deletedAt": c["deleted_at"].isoformat() if c["deleted_at"] else None}


@router.get("/requests/{request_id}/comments")
def list_comments(request_id: PositiveInt, request: Request, limit: PageLimit = 50, beforeId: BeforeId = None):
    user_id = _require_user(request)
    with db() as conn:
        cur = conn.cursor()
        req = _request(cur, request_id)
        _require_unblocked_pair(cur, req["author_id"], user_id)
        cur.execute("""SELECT c.id FROM request_comments c WHERE c.request_id=%s AND (%s IS NULL OR c.id < %s)
                       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
                         (b.blocker_id=%s AND b.blocked_user_id=c.author_id) OR
                         (b.blocker_id=c.author_id AND b.blocked_user_id=%s))
                       ORDER BY c.id DESC LIMIT %s""", (request_id, beforeId, beforeId, user_id, user_id, limit))
        ids = cur.fetchall()
        return [_comment(cur, c["id"]) for c in reversed(ids)]


@router.post("/requests/{request_id}/comments", status_code=201)
def create_comment(request_id: PositiveInt, body: CommentBody, request: Request):
    user_id = _require_user(request)
    with db() as conn:
        cur = conn.cursor()
        req = _request(cur, request_id, lock=True)
        _require_unblocked_pair(cur, req["author_id"], user_id)
        if body.parentId is not None:
            cur.execute("SELECT * FROM request_comments WHERE id=%s AND request_id=%s", (body.parentId, request_id))
            parent = cur.fetchone()
            if not parent or parent["parent_id"] is not None:
                raise HTTPException(400, "Replies require a top-level comment on this request")
            _require_unblocked_pair(cur, parent["author_id"], user_id)
        cur.execute("SELECT * FROM request_comments WHERE author_id=%s AND request_id=%s AND client_comment_id=%s", (user_id, request_id, str(body.clientCommentId)))
        existing = cur.fetchone()
        if existing:
            if existing["deleted_at"]:
                return _comment(cur, existing["id"])
            if existing["body"] != body.body or existing["parent_id"] != body.parentId:
                raise HTTPException(409, "Comment operation already used for different content")
            return _comment(cur, existing["id"])
        cur.execute("INSERT INTO request_comments (request_id,author_id,parent_id,body,client_comment_id) VALUES (%s,%s,%s,%s,%s) RETURNING id",
                    (request_id, user_id, body.parentId, body.body, str(body.clientCommentId)))
        return _comment(cur, cur.fetchone()["id"])


@router.get("/connections")
def list_connections(request: Request, limit: PageLimit = 50, beforeId: BeforeId = None):
    user_id = _require_user(request)
    with db() as conn:
        cur = conn.cursor()
        cur.execute("""SELECT DISTINCT ON (u.id) u.id, u.name, r.id AS request_id, r.title
                       FROM requests r JOIN users u ON u.id=CASE WHEN r.author_id=%s THEN r.matched_user_id ELSE r.author_id END
                       WHERE r.status='matched' AND (r.author_id=%s OR r.matched_user_id=%s)
                       AND (%s IS NULL OR u.id < %s) AND u.id<>%s
                       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
                         (b.blocker_id=%s AND b.blocked_user_id=u.id) OR (b.blocker_id=u.id AND b.blocked_user_id=%s))
                       ORDER BY u.id DESC, r.id DESC LIMIT %s""",
                    (user_id, user_id, user_id, beforeId, beforeId, user_id, user_id, user_id, limit))
        return [{"userId": c["id"], "name": c["name"], "requestId": c["request_id"], "requestTitle": c["title"]} for c in cur.fetchall()]


@router.get("/request-activity")
def request_activity(request: Request, limit: PageLimit = 50, beforeId: BeforeId = None):
    user_id = _require_user(request)
    with db() as conn:
        cur = conn.cursor()
        cur.execute("""SELECT r.* FROM requests r WHERE (r.author_id=%s OR r.matched_user_id=%s OR
                       EXISTS (SELECT 1 FROM request_applications a WHERE a.request_id=r.id AND a.applicant_id=%s))
                       AND (%s IS NULL OR r.id < %s) ORDER BY r.id DESC LIMIT %s""", (user_id, user_id, user_id, beforeId, beforeId, limit))
        rows = cur.fetchall()
        return [build_request_response(cur, r, preview=True) for r in rows]


class EditCommentBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    body: str = Field(min_length=1,max_length=2000)

    @field_validator('body')
    @classmethod
    def clean_body(cls,value):
        if not value.strip():
            raise ValueError('Comment must contain text')
        return value.strip()


def _own_comment(cur,request_id,comment_id,user_id):
    req = _request(cur,request_id,lock=True)
    _require_unblocked_pair(cur,req['author_id'],user_id)
    cur.execute('SELECT * FROM request_comments WHERE id=%s AND request_id=%s FOR UPDATE',(comment_id,request_id))
    row=cur.fetchone()
    if not row:
        raise HTTPException(404,'Comment not found')
    if row['author_id'] != user_id:
        raise HTTPException(403,'Forbidden')
    if row['parent_id']:
        cur.execute('SELECT author_id FROM request_comments WHERE id=%s',(row['parent_id'],))
        _require_unblocked_pair(cur,cur.fetchone()['author_id'],user_id)
    return row


@router.patch('/requests/{request_id}/comments/{comment_id}')
def edit_comment(request_id: PositiveInt,comment_id: PositiveInt,body: EditCommentBody,request: Request):
    user_id=_require_user(request)
    with db() as conn:
        cur=conn.cursor()
        row=_own_comment(cur,request_id,comment_id,user_id)
        if row['deleted_at']:
            raise HTTPException(409,'Deleted comments cannot be edited')
        cur.execute('UPDATE request_comments SET body=%s,updated_at=now() WHERE id=%s',(body.body,comment_id))
        return _comment(cur,comment_id)


@router.delete('/requests/{request_id}/comments/{comment_id}')
def delete_comment(request_id: PositiveInt,comment_id: PositiveInt,request: Request):
    user_id=_require_user(request)
    with db() as conn:
        cur=conn.cursor()
        row=_own_comment(cur,request_id,comment_id,user_id)
        if not row['deleted_at']:
            cur.execute("UPDATE request_comments SET body='',deleted_at=now() WHERE id=%s",(comment_id,))
        return _comment(cur,comment_id)
