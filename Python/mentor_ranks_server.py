"""Small lesson server for the mentor ranking student/reference modules."""

import argparse
import importlib
import os
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()
load_dotenv(dotenv_path=Path(__file__).with_name(".env"), override=False)


def _rank_router(answer: bool):
    module_name = "mentor_ranks_answer" if answer else "mentor_ranks"
    try:
        return importlib.import_module(module_name).router
    except ModuleNotFoundError as exc:
        if answer and exc.name == module_name:
            raise RuntimeError(
                "mentor_ranks_answer is unavailable; complete Task 3 before using --answer"
            ) from exc
        raise


def create_app(answer: bool = False):
    """Build the loopback lesson app using the explicitly selected rank module."""
    missing = [name for name in ("DATABASE_URL", "SESSION_SECRET") if not os.environ.get(name)]
    if missing:
        raise RuntimeError(f"Required environment variable missing: {', '.join(missing)}")

    from fastapi import FastAPI
    from starlette.middleware.sessions import SessionMiddleware

    from api.routers import practice
    from routers import auth, matches, users

    app = FastAPI(title="PeerBridge Mentor Ranks Lesson")
    app.add_middleware(
        SessionMiddleware,
        secret_key=os.environ["SESSION_SECRET"],
        session_cookie="peerbridge_session",
        max_age=7 * 24 * 60 * 60,
        https_only=os.environ.get("NODE_ENV") == "production",
        same_site="lax",
    )
    app.include_router(auth.router, prefix="/api")
    app.include_router(users.router, prefix="/api")
    app.include_router(matches.router, prefix="/api")
    app.include_router(practice.router, prefix="/api")
    app.include_router(_rank_router(answer), prefix="/api")

    @app.get("/api/healthz")
    def health():
        return {"status": "ok", "backend": "python-mentor-ranks"}

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the mentor ranking lesson server")
    parser.add_argument("--answer", action="store_true", help="use mentor_ranks_answer.py")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()

    import uvicorn

    uvicorn.run(create_app(answer=args.answer), host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
