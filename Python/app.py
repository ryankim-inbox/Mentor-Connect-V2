"""
Creates a FastAPI server.
"""

from fastapi import FastAPI
from pydantic import BaseModel

#from find_matches import find_matches


app = FastAPI(title="Mentor Matching Service")


@app.get("/")
def home():
    return {
        "message": "Mentor Matching Service is running",
        "example": "/matches/1",
    }


@app.get("/matches/{question_id}")
def get_matches(question_id: int, limit: int = 5):
    """
    Get mentor matches for one question.
    """
    #return find_matches(question_id=question_id, limit=limit)
    return {
        "question_id": question_id,
        "limit": limit,
        "matches": [],
        "message": "TODO: implement matching algorithm"
    }


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
    #return find_matches(question_id=request.question_id, limit=request.limit)
