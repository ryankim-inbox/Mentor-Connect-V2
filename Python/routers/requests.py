import re
from datetime import datetime

from fastapi import APIRouter, Request, HTTPException, Response, Query
from pydantic import BaseModel, Field, PositiveInt, field_validator
from psycopg2.errors import ForeignKeyViolation
from typing import Annotated, Literal, Optional, List
from db import db
from request_events import record_match_event

router = APIRouter()

# Weekly slot format shared with the frontend selector and the DB seed:
# 'Ddd HH:00' on a 24-hour clock, e.g. 'Mon 17:00' .. 'Sun 23:00'.
TIME_SLOT_RE = re.compile(r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([01][0-9]|2[0-3]):00$")
MAX_PREFERRED_TIMES = 30
TagIds = Annotated[List[PositiveInt], Field(max_length=20)]

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

def validate_request_text(value, max_bytes):
    if value is None:
        return None
    if len(value.encode("utf-8")) > max_bytes or not value.strip():
        raise ValueError(f"must contain text and be at most {max_bytes} UTF-8 bytes")
    return value.strip()


class RequestTextBody(BaseModel):
    @field_validator("title", check_fields=False)
    @classmethod
    def check_title(cls, value):
        return validate_request_text(value, 200)

    @field_validator("description", check_fields=False)
    @classmethod
    def check_description(cls, value):
        return validate_request_text(value, 4000)

    @field_validator("tagIds", check_fields=False)
    @classmethod
    def check_tag_ids(cls, value):
        if value is not None and len(set(value)) != len(value):
            raise ValueError("tagIds cannot contain duplicates")
        return value


class CreateRequestBody(RequestTextBody):
    districtId: PositiveInt
    title: str
    description: str
    role: Literal["mentor", "mentee"]
    tagIds: Optional[TagIds] = Field(default_factory=list)
    preferredTimes: Optional[List[str]] = []

    @field_validator("preferredTimes")
    @classmethod
    def check_preferred_times(cls, value):
        return validate_preferred_times(value)

class UpdateRequestBody(RequestTextBody):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[Literal["open", "matched", "closed"]] = None
    tagIds: Optional[TagIds] = None


def validate_tag_references(cur, tag_ids):
    if tag_ids:
        cur.execute("SELECT id FROM tags WHERE id = ANY(%s)", (tag_ids,))
        if len(cur.fetchall()) != len(tag_ids):
            raise HTTPException(status_code=404, detail="Tag not found")

def request_list_preview(value: str, max_bytes: int) -> str:
    return value.encode("utf-8")[:max_bytes].decode("utf-8", errors="ignore")


def parse_request_cursor(value: str) -> tuple[datetime, int]:
    if len(value) > 96 or not re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
        r"(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})\|[1-9][0-9]*", value
    ):
        raise HTTPException(status_code=422, detail="Invalid request cursor")
    timestamp, request_id = value.split("|")
    try:
        created_at = datetime.fromisoformat(timestamp)
        # fromisoformat normalizes oversized offset minutes; reject that syntax.
        if not timestamp.endswith("Z") and int(timestamp[-2:]) > 59:
            raise ValueError("Invalid offset")
        identifier = int(request_id)
        if identifier > 9007199254740991:
            raise ValueError("Invalid identifier")
        return created_at, identifier
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid request cursor") from None


def build_request_response(cur, req, *, preview=False):
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
        "title": request_list_preview(req["title"], 200) if preview else req["title"],
        "description": request_list_preview(req["description"], 4000) if preview else req["description"],
        "descriptionTruncated": preview and len(req["description"].encode("utf-8")) > 4000,
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
    limit: Annotated[int, Query(ge=1, le=50)] = 50,
    before: Optional[str] = None,
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

    if tagId:
        conditions.append("EXISTS (SELECT 1 FROM request_tags rt WHERE rt.request_id = r.id AND rt.tag_id = %s)")
        params.append(tagId)
    if before is not None:
        created_at, request_id = parse_request_cursor(before)
        conditions.append("(r.created_at, r.id) < (%s, %s)")
        params.extend([created_at, request_id])
    params.append(limit)
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"SELECT r.* FROM requests r {where} ORDER BY r.created_at DESC, r.id DESC LIMIT %s"

    with db() as conn:
        cur = conn.cursor()
        cur.execute(query, params)
        reqs = cur.fetchall()

        return [build_request_response(cur, r, preview=True) for r in reqs]

@router.post("/requests", status_code=201)
def create_request(body: CreateRequestBody, request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        with db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id FROM districts WHERE id = %s", (body.districtId,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="District not found")
            validate_tag_references(cur, body.tagIds)
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
    except ForeignKeyViolation as exc:
        if exc.diag.constraint_name in ("requests_district_id_fkey", "request_tags_tag_id_fkey"):
            raise HTTPException(status_code=404, detail="District or tag not found") from None
        raise

@router.get("/requests/{request_id}")
def get_request(request_id: PositiveInt):
    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM requests WHERE id = %s", (request_id,))
        req = cur.fetchone()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        return build_request_response(cur, req)

@router.patch("/requests/{request_id}")
def update_request(request_id: PositiveInt, body: UpdateRequestBody, request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        with db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM requests WHERE id = %s FOR UPDATE", (request_id,))
            existing = cur.fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Request not found")
            if existing["author_id"] != user_id:
                raise HTTPException(status_code=403, detail="Forbidden")
            if body.status == "matched" and existing["status"] != "matched":
                raise HTTPException(status_code=409, detail="Use Connect to match a request")
            validate_tag_references(cur, body.tagIds)

            fields = []
            values = []
            if body.title is not None:
                fields.append("title = %s")
                values.append(body.title)
            if body.description is not None:
                fields.append("description = %s")
                values.append(body.description)
            if body.status is not None and body.status != existing["status"]:
                fields.append("status = %s")
                values.append(body.status)
                fields.append("updated_at = now()")
            if body.status == "open":
                fields.append("matched_user_id = NULL")

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
    except ForeignKeyViolation as exc:
        if exc.diag.constraint_name == "request_tags_tag_id_fkey":
            raise HTTPException(status_code=404, detail="Tag not found") from None
        raise

@router.delete("/requests/{request_id}", status_code=204)
def delete_request(request_id: PositiveInt, request: Request):
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
def match_request(request_id: PositiveInt, request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    with db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM requests WHERE id = %s FOR UPDATE", (request_id,))
        req = cur.fetchone()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req["author_id"] == user_id:
            raise HTTPException(status_code=400, detail="Cannot match your own request")
        if req["status"] != "open":
            raise HTTPException(status_code=400, detail="Request is not open")

        cur.execute(
            "UPDATE requests SET status = 'matched', matched_user_id = %s, updated_at = now() WHERE id = %s RETURNING *",
            (user_id, request_id),
        )
        updated = cur.fetchone()
        record_match_event(cur, updated)
        return build_request_response(cur, updated)
