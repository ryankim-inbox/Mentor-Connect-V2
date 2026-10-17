from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel, ConfigDict, field_validator
from typing import Optional, List
from db import db
from routers.auth import normalize_display_name, format_user
from security import require_user, member
from routers.chat import _require_unblocked_pair

router = APIRouter(dependencies=[Depends(require_user)])

class UpdateUserBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("role")
    @classmethod
    def valid_role(cls, value):
        if value is not None and value not in ("mentor","mentee","both"):
            raise ValueError("Role must be mentor, mentee, or both")
        return value
    name: Optional[str] = None
    bio: Optional[str] = None
    role: Optional[str] = None
    subjects: Optional[List[str]] = None

    @field_validator("name")
    @classmethod
    def name_must_be_valid(cls, value):
        return normalize_display_name(value) if value is not None else None

@router.get("/users/{user_id}")
def get_user(user_id: int, request: Request):
    viewer = require_user(request)
    if viewer["id"] != user_id:
        member(viewer)
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT u.*, d.name as district_name FROM users u LEFT JOIN districts d ON d.id = u.district_id WHERE u.id = %s",
            (user_id,),
        )
        user = cur.fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if viewer["id"] != user_id:
        with db() as conn:
            _require_unblocked_pair(conn.cursor(),viewer["id"],user_id)
        return {"id":user["id"],"name":user["name"],"subjects":user["subjects"] or [],"createdAt":user["created_at"].isoformat()}
    return format_user(user, user["district_name"])

@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UpdateUserBody, request: Request):
    session_user_id = require_user(request)["id"]
    if not session_user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if session_user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    fields = []
    values = []
    if body.name is not None:
        fields.append("name = %s")
        values.append(body.name)
    if "bio" in body.model_fields_set:
        fields.append("bio = %s")
        values.append(body.bio)
    if body.role is not None:
        fields.append("role = %s")
        values.append(body.role)
    if body.subjects is not None:
        fields.append("subjects = %s")
        values.append(body.subjects)

    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    values.append(user_id)
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE users SET {', '.join(fields)} WHERE id = %s RETURNING *",
            values,
        )
        user = cur.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        cur.execute("SELECT name FROM districts WHERE id = %s", (user["district_id"],))
        district = cur.fetchone()

    return format_user(user, district["name"] if district else None)
