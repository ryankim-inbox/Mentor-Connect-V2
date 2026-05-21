from fastapi import APIRouter, Request, HTTPException, Response
from pydantic import BaseModel
from typing import Optional
from db import db

router = APIRouter()

class CreateReportBody(BaseModel):
    reportedUserId: int
    reason: str
    description: Optional[str] = None

class BlockUserBody(BaseModel):
    blockedUserId: int

@router.post("/reports", status_code=201)
def create_report(body: CreateReportBody, request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO reports (reporter_id, reported_user_id, reason, description) VALUES (%s, %s, %s, %s)",
            (user_id, body.reportedUserId, body.reason, body.description),
        )
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

    with db() as conn:
        cur = conn.cursor()
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
    return {"message": "User blocked successfully"}

@router.delete("/blocks/{blocked_user_id}", status_code=204)
def unblock_user(blocked_user_id: int, request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM blocks WHERE blocker_id = %s AND blocked_user_id = %s",
            (user_id, blocked_user_id),
        )
