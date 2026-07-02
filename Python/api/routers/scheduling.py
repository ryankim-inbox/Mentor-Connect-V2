from fastapi import APIRouter, HTTPException

from api.adapters import scheduling_adapter

router = APIRouter()


@router.get("/scheduling/status")
def scheduling_status():
    return scheduling_adapter.get_scheduling_status()


@router.get("/scheduling/overview")
def scheduling_overview():
    return scheduling_adapter.get_overview()


@router.get("/scheduling/suggest")
def scheduling_suggest(user_a: int, user_b: int):
    try:
        return scheduling_adapter.suggest_times(user_a, user_b)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error))
