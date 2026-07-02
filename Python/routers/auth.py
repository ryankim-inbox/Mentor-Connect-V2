from fastapi import APIRouter, Request, Response, HTTPException
from pydantic import BaseModel, field_validator
from db import db
import bcrypt

router = APIRouter()

class RegisterBody(BaseModel):
    email: str
    name: str
    password: str
    role: str
    districtId: int

    @field_validator("email")
    @classmethod
    def email_must_be_edu(cls, v):
        if not v.lower().endswith(".edu"):
            raise ValueError("Only .edu school email addresses are allowed")
        return v.lower()

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v):
        if v not in ("mentor", "mentee", "both"):
            raise ValueError("Role must be mentor, mentee, or both")
        return v

class LoginBody(BaseModel):
    email: str
    password: str

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

@router.post("/auth/register", status_code=201)
def register(body: RegisterBody, request: Request):
    with db() as conn:
        cur = conn.cursor()

        cur.execute("SELECT id FROM users WHERE email = %s", (body.email,))
        if cur.fetchone():
            raise HTTPException(status_code=400, detail="Email already registered")

        cur.execute("SELECT id, name FROM districts WHERE id = %s", (body.districtId,))
        district = cur.fetchone()
        if not district:
            raise HTTPException(status_code=400, detail="Invalid district")

        password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()

        cur.execute(
            """INSERT INTO users (email, name, password_hash, role, district_id, is_verified, subjects)
               VALUES (%s, %s, %s, %s, %s, true, '{}') RETURNING *""",
            (body.email, body.name, password_hash, body.role, body.districtId),
        )
        user = cur.fetchone()

    request.session["user_id"] = user["id"]
    return {"user": format_user(user, district["name"]), "message": "Registered successfully"}

@router.post("/auth/login")
def login(body: LoginBody, request: Request):
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT u.*, d.name as district_name FROM users u LEFT JOIN districts d ON d.id = u.district_id WHERE u.email = %s",
            (body.email.lower(),),
        )
        user = cur.fetchone()

    if not user or not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    request.session["user_id"] = user["id"]
    return {"user": format_user(user, user["district_name"]), "message": "Logged in successfully"}

@router.post("/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"message": "Logged out successfully"}

@router.get("/auth/me")
def me(request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT u.*, d.name as district_name FROM users u LEFT JOIN districts d ON d.id = u.district_id WHERE u.id = %s",
            (user_id,),
        )
        user = cur.fetchone()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return format_user(user, user["district_name"])
