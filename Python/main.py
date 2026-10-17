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

from routers import auth, users, districts, tags, requests, reports, stats, matches, chat
from api.routers import admin, analytics, practice, python_reports, scheduling
# Python/dependencies.py
from fastapi import HTTPException, Depends, status

# Mock function to get current user (replace with your actual auth logic)
async def get_current_user():
    # Your JWT decoding / user fetching logic here
    pass

# Admin role verification dependency
def verify_admin(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Admin privileges required."
        )
    return current_user


# Python/routers/questions.py
from fastapi import APIRouter, BackgroundTasks, Depends
from services.matching import trigger_match_and_notify

router = APIRouter()

@router.post("/questions")
async def create_question(
        question_data: dict,
        background_tasks: BackgroundTasks
):
    # 1. Save the posted question to your database
    new_question_id = 123  # Replace with actual DB insertion return value

    # 2. Automatically queue the match & notification task in the background
    background_tasks.add_task(trigger_match_and_notify, new_question_id)

    return {"status": "success", "message": "Question posted successfully!"}

# Python/services/matching.py
async def trigger_match_and_notify(question_id: int):
    """
    Finds relevant mentors/peers matching the question criteria
    and sends them a notification.
    """
    # 1. Fetch question details from DB
    # 2. Run your match function logic
    # 3. Trigger email, WebSocket, or push notifications
    print(f"Triggering matching logic and notifications for question {question_id}...")


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

# Chat learning scaffold — REST + WebSocket stubs the student implements
# (see Python/routers/chat.py and docs/STUDENT_CHAT_BACKEND_GUIDE.md).
app.include_router(chat.router, prefix="/api")
app.include_router(chat.ws_router)  # WS paths start with /ws/ — no /api prefix

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