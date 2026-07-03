import re

from fastapi import APIRouter, Request, HTTPException, Response
from pydantic import BaseModel, field_validator
from typing import Optional, List
from db import db

router = APIRouter()

# Weekly slot format shared with the frontend selector and the DB seed:
# 'Ddd HH:00' on a 24-hour clock, e.g. 'Mon 17:00' .. 'Sun 23:00'.
TIME_SLOT_RE = re.compile(r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([01][0-9]|2[0-3]):00$")
MAX_PREFERRED_TIMES = 30

def validate_preferred_times(value):
    if value is None:
        return []
    if len(value) > MAX_PREFERRED_TIMES:
        raise ValueError(f"preferredTimes cannot have more than {MAX_PREFERRED_TIMES} slots")
    if len(set(value)) != len(value):
        raise ValueError("preferredTimes cannot contain duplicates")
    for slot in value:
        if not TIME_SLOT_RE.match(slot):
            raise ValueError(
                f"invalid time slot '{slot}': expected 'Ddd HH:00' (e.g. 'Mon 17:00', 24-hour clock)"
            )
    return value

class CreateRequestBody(BaseModel):
    districtId: int
    title: str
    description: str
    role: str
    tagIds: Optional[List[int]] = []
    preferredTimes: Optional[List[str]] = []

    @field_validator("preferredTimes")
    @classmethod
    def check_preferred_times(cls, value):
        return validate_preferred_times(value)

class UpdateRequestBody(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    tagIds: Optional[List[int]] = None

def build_request_response(cur, req):
    cur.execute("SELECT id, name FROM users WHERE id = %s", (req["author_id"],))
    author = cur.fetchone()
    cur.execute("SELECT name FROM districts WHERE id = %s", (req["district_id"],))
    district = cur.fetchone()
    cur.execute(
        "SELECT t.id, t.name, t.color FROM request_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.request_id = %s",
        (req["id"],),
    )
    tags = cur.fetchall()
    matched_user_name = None
    if req["matched_user_id"]:
        cur.execute("SELECT name FROM users WHERE id = %s", (req["matched_user_id"],))
        mu = cur.fetchone()
        matched_user_name = mu["name"] if mu else None

    return {
        "id": req["id"],
        "authorId": req["author_id"],
        "authorName": author["name"] if author else "Unknown",
        "authorRole": req["role"],
        "districtId": req["district_id"],
        "districtName": district["name"] if district else "Unknown",
        "title": req["title"],
        "description": req["description"],
        "tags": [{"id": t["id"], "name": t["name"], "color": t["color"], "requestCount": 0} for t in tags],
        "status": req["status"],
        "matchedUserId": req["matched_user_id"],
        "matchedUserName": matched_user_name,
        "createdAt": req["created_at"].isoformat(),
        # tolerate databases that predate the preferred_times migration
        "preferredTimes": req.get("preferred_times") or [],
    }

@router.get("/requests")
def list_requests(
    districtId: Optional[int] = None,
    role: Optional[str] = None,
    status: Optional[str] = None,
    tagId: Optional[int] = None,
):
    conditions = []
    params = []
    effective_status = status or "open"
    conditions.append("r.status = %s")
    params.append(effective_status)
    if districtId:
        conditions.append("r.district_id = %s")
        params.append(districtId)
    if role:
        conditions.append("r.role = %s")
        params.append(role)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"SELECT r.* FROM requests r {where} ORDER BY r.created_at DESC"

    with db() as conn:
        cur = conn.cursor()
        cur.execute(query, params)
        reqs = cur.fetchall()

        if tagId:
            cur.execute("SELECT request_id FROM request_tags WHERE tag_id = %s", (tagId,))
            ids = {row["request_id"] for row in cur.fetchall()}
            reqs = [r for r in reqs if r["id"] in ids]

        return [build_request_response(cur, r) for r in reqs]

@router.post("/requests", status_code=201)
def create_request(body: CreateRequestBody, request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO requests (author_id, district_id, title, description, role, status, preferred_times)
               VALUES (%s, %s, %s, %s, %s, 'open', %s) RETURNING *""",
            (user_id, body.districtId, body.title, body.description, body.role, body.preferredTimes or []),
        )
        req = cur.fetchone()

        if body.tagIds:
            for tag_id in body.tagIds:
                cur.execute(
                    "INSERT INTO request_tags (request_id, tag_id) VALUES (%s, %s)",
                    (req["id"], tag_id),
                )

        return build_request_response(cur, req)

@router.get("/requests/{request_id}")
def get_request(request_id: int):
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM requests WHERE id = %s", (request_id,))
        req = cur.fetchone()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        return build_request_response(cur, req)

@router.patch("/requests/{request_id}")
def update_request(request_id: int, body: UpdateRequestBody, request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM requests WHERE id = %s", (request_id,))
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Request not found")
        if existing["author_id"] != user_id:
            raise HTTPException(status_code=403, detail="Forbidden")

        fields = []
        values = []
        if body.title is not None:
            fields.append("title = %s")
            values.append(body.title)
        if body.description is not None:
            fields.append("description = %s")
            values.append(body.description)
        if body.status is not None:
            fields.append("status = %s")
            values.append(body.status)

        if fields:
            values.append(request_id)
            cur.execute(
                f"UPDATE requests SET {', '.join(fields)} WHERE id = %s RETURNING *",
                values,
            )
            req = cur.fetchone()
        else:
            req = existing

        if body.tagIds is not None:
            cur.execute("DELETE FROM request_tags WHERE request_id = %s", (request_id,))
            for tag_id in body.tagIds:
                cur.execute(
                    "INSERT INTO request_tags (request_id, tag_id) VALUES (%s, %s)",
                    (request_id, tag_id),
                )

        return build_request_response(cur, req)

@router.delete("/requests/{request_id}", status_code=204)
def delete_request(request_id: int, request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM requests WHERE id = %s", (request_id,))
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Request not found")
        if existing["author_id"] != user_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        cur.execute("DELETE FROM request_tags WHERE request_id = %s", (request_id,))
        cur.execute("DELETE FROM requests WHERE id = %s", (request_id,))

@router.post("/requests/{request_id}/match")
def match_request(request_id: int, request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM requests WHERE id = %s", (request_id,))
        req = cur.fetchone()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req["author_id"] == user_id:
            raise HTTPException(status_code=400, detail="Cannot match your own request")
        if req["status"] != "open":
            raise HTTPException(status_code=400, detail="Request is not open")

        cur.execute(
            "UPDATE requests SET status = 'matched', matched_user_id = %s WHERE id = %s RETURNING *",
            (user_id, request_id),
        )
        updated = cur.fetchone()
        return build_request_response(cur, updated)
