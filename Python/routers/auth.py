from fastapi import APIRouter, Depends, Request, Response, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool
from db import db
import bcrypt
import re
import hashlib
import secrets
from security import require_user
from email_delivery import deliver_verification, DeliveryUnavailable

router = APIRouter()

def normalize_display_name(value: str) -> str:
    if len(value.encode("utf-8")) > 120:
        raise ValueError("Use a name of 1–120 UTF-8 bytes.")
    # Names trim the union of Python whitespace and JavaScript trim whitespace.
    normalized = re.sub(r"^[\s\ufeff]+|[\s\ufeff]+$", "", value)
    if not normalized:
        raise ValueError("Use a name of 1–120 UTF-8 bytes.")
    return normalized

class RegisterBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str
    name: str
    password: str
    role: str
    districtId: int

    @field_validator("name")
    @classmethod
    def name_must_be_valid(cls, value):
        return normalize_display_name(value)

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
    model_config = ConfigDict(extra="forbid")
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
        "isVerified": user["email_verified_at"] is not None,
        "isAdmin": user["is_admin"],
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
               VALUES (%s, %s, %s, %s, %s, false, '{}') RETURNING *""",
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
    user = require_user(request)
    return format_user(user, user['district_name'])


class ConfirmBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    token: str = Field(min_length=43, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')


def _limit_attempt(cur, user_id, kind):
    # Serialize all token transitions per account, including multi-worker races.
    cur.execute('SELECT * FROM users WHERE id=%s FOR UPDATE', (user_id,))
    user = cur.fetchone()
    if not user:
        raise HTTPException(401, 'Not authenticated')
    cur.execute("DELETE FROM email_verification_requests WHERE user_id=%s AND requested_at < now()-interval '1 hour'",(user_id,))
    cur.execute("SELECT count(*) AS n, COALESCE(bool_or(requested_at > now()-interval '60 seconds'),false) AS recent FROM email_verification_requests WHERE user_id=%s AND kind=%s AND requested_at > now()-(CASE WHEN %s='confirm' THEN interval '15 minutes' ELSE interval '1 hour' END)",(user_id,kind,kind))
    history = cur.fetchone()
    if history['n'] >= (10 if kind=='confirm' else 5) or (kind=='request' and history['recent']):
        raise HTTPException(429,'Verification rate limit exceeded',headers={'Retry-After':'60'})
    cur.execute('INSERT INTO email_verification_requests(user_id,kind) VALUES (%s,%s)',(user_id,kind))
    return user


@router.post('/auth/verification/request',status_code=202)
async def request_verification(request: Request):
    user = await run_in_threadpool(require_user, request)
    if await request.body():
        raise HTTPException(422,'Request body must be empty')
    return await run_in_threadpool(_request_verification, user['id'])


def _request_verification(user_id):
    # Keep the lock, delivery, and commit together without blocking the event loop.
    delivery_failed = False
    with db() as conn:
        cur = conn.cursor()
        user = _limit_attempt(cur,user_id,'request')
        token = secrets.token_urlsafe(32)
        try:
            deliver_verification(user['email'],token)
        except DeliveryUnavailable:
            delivery_failed = True
        else:
            cur.execute('DELETE FROM email_verification_tokens WHERE user_id=%s',(user['id'],))
            cur.execute("INSERT INTO email_verification_tokens(user_id,email,token_hash,expires_at) VALUES (%s,%s,%s,now()+interval '30 minutes')",(user['id'],user['email'],hashlib.sha256(token.encode()).hexdigest()))
    if delivery_failed:
        raise HTTPException(503, 'Email delivery unavailable')
    return {'message':'Verification email sent'}


@router.post('/auth/verification/confirm', dependencies=[Depends(require_user)])
def confirm_verification(body: ConfirmBody, request: Request):
    user = require_user(request)
    with db() as conn:
        cur = conn.cursor()
        user = _limit_attempt(cur,user['id'],'confirm')
        cur.execute('DELETE FROM email_verification_tokens WHERE user_id=%s AND email=%s AND token_hash=%s AND expires_at>now() RETURNING user_id', (user['id'],user['email'],hashlib.sha256(body.token.encode()).hexdigest()))
        found = cur.fetchone()
        if found:
            cur.execute('UPDATE users SET email_verified_at=now(),is_verified=true WHERE id=%s RETURNING *',(user['id'],))
            user = cur.fetchone()
            cur.execute('SELECT name FROM districts WHERE id=%s',(user['district_id'],))
            district = cur.fetchone()
    if not found:
        raise HTTPException(400,'Invalid or expired verification token')
    return format_user(user,district['name'])
