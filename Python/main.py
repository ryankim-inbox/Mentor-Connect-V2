import os
import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()
# Also load Python/.env so the server can be started from the repo root
# (e.g. `python Python/main.py`), not only with cwd=Python/.
load_dotenv(dotenv_path=Path(__file__).with_name(".env"), override=False)

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
from api.routers import admin, analytics, practice, python_reports, scheduling

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

# Adapter routers that wrap the student practice files in Python/ without
# modifying them (see api/adapters/).
app.include_router(practice.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(python_reports.router, prefix="/api")
app.include_router(scheduling.router, prefix="/api")
app.include_router(admin.router, prefix="/api")

@app.get("/api/healthz")
def health():
    return {"status": "ok", "backend": "python-fastapi"}

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)