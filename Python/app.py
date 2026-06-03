"""
Creates a FastAPI server.
"""

from typing import Any

from fastapi import Body, FastAPI
from pydantic import BaseModel

from integration_api import (
    get_block_status,
    get_location_status,
    get_matching_result,
    get_practice_status,
    get_raw_module_metadata,
    run_location_test,
)


app = FastAPI(title="Mentor Matching Service")


@app.get("/")
def home():
    return {
        "message": "Mentor Matching Service is running",
        "example": "/practice/status",
    }


@app.get("/practice/status")
def practice_status():
    """
    Get overall safe status for the student practice engines.
    """
    return get_practice_status()


@app.get("/practice/matching/{question_id}")
def practice_matching(question_id: int, limit: int = 5):
    """
    Safely run or check the student matching engine.
    """
    return get_matching_result(question_id=question_id, limit=limit)


@app.get("/practice/locations/status")
def practice_locations_status():
    """
    Safely inspect the student location engine.
    """
    return get_location_status()


@app.post("/practice/locations/test")
def practice_locations_test(test_input: dict[str, Any] | None = Body(default=None)):
    """
    Safely run an obvious location helper when the input matches one.
    """
    return run_location_test(test_input or {})


@app.get("/practice/blocks/status")
def practice_blocks_status():
    """
    Safely inspect the student block/report engine.
    """
    return get_block_status()


@app.get("/practice/raw/{module_name}")
def practice_raw_module(module_name: str):
    """
    Return safe metadata for an allowed student module.
    """
    return get_raw_module_metadata(module_name)


@app.get("/matches/{question_id}")
def get_matches(question_id: int, limit: int = 5):
    """
    Compatibility route for the recommendation UI.
    """
    return get_matching_result(question_id=question_id, limit=limit)


@app.get("/blocks/status")
def blocks_status():
    """
    Compatibility route for the previous block/report status UI.
    """
    return get_block_status()


class MatchRequest(BaseModel):
    question_id: int
    limit: int = 5


@app.post("/matches")
def post_matches(request: MatchRequest):
    """
    Same as GET /matches/{question_id}, but uses POST body.

    Example body:
    {
        "question_id": 1,
        "limit": 5
    }
    """
    return get_matching_result(question_id=request.question_id, limit=request.limit)
