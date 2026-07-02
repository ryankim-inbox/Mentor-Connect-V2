from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from db import db

router = APIRouter()

class UpdateUserBody(BaseModel):
    name: Optional[str] = None
    bio: Optional[str] = None
    role: Optional[str] = None
    subjects: Optional[List[str]] = None

def format_user(user, district_name):
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "districtId": user["district_id"],
        "districtName": district_name,
        "bio": user["bio"],
        "subjects": user["subjects"] or [],
        "isVerified": user["is_verified"],
        "createdAt": user["created_at"].isoformat(),
    }

@router.get("/users/{user_id}")
def get_user(user_id: int):
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT u.*, d.name as district_name FROM users u LEFT JOIN districts d ON d.id = u.district_id WHERE u.id = %s",
            (user_id,),
        )
        user = cur.fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return format_user(user, user["district_name"])

@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UpdateUserBody, request: Request):
    session_user_id = request.session.get("user_id")
    if not session_user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if session_user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    fields = []
    values = []
    if body.name is not None:
        fields.append("name = %s")
        values.append(body.name)
    if body.bio is not None:
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
