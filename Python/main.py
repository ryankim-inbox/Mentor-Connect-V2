import os
import sys

from dotenv import load_dotenv
load_dotenv()

if not os.environ.get("SESSION_SECRET"):
    print("ERROR: SESSION_SECRET environment variable is required", file=sys.stderr)
    sys.exit(1)

if not os.environ.get("DATABASE_URL"):
    print("ERROR: DATABASE_URL environment variable is required", file=sys.stderr)
    sys.exit(1)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from routers import auth, users, districts, tags, requests, reports, stats, matches

app = FastAPI(title="PeerBridge Python API")

app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SESSION_SECRET"],
    session_cookie="peerbridge_session",
    max_age=7 * 24 * 60 * 60,
    https_only=os.environ.get("NODE_ENV") == "production",
    same_site="lax",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(districts.router, prefix="/api")
app.include_router(tags.router, prefix="/api")
app.include_router(requests.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(matches.router, prefix="/api")

@app.get("/api/healthz")
def health():
    return {"status": "ok", "backend": "python-fastapi"}