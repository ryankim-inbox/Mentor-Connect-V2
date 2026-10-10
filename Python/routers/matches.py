from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, PositiveInt

import integration_api

router = APIRouter()


@router.get("/matches/{question_id}")
def get_matches(question_id: PositiveInt, limit: Annotated[int, Query(ge=1, le=20)] = 5):
    """
    Run the student matching engine (Python/find_matches.py) for one question.
    """
    return integration_api.get_matching_result(question_id=question_id, limit=limit)


class MatchRequest(BaseModel):
    question_id: PositiveInt
    limit: int = Field(default=5, ge=1, le=20)


@router.post("/matches")
def post_matches(request: MatchRequest):
    """
    Same as GET /matches/{question_id}, but uses a POST body.
    """
    return integration_api.get_matching_result(
        question_id=request.question_id, limit=request.limit
    )
