from fastapi import APIRouter

from api.adapters import analysis_adapter

router = APIRouter()


@router.get("/analysis/status")
def analysis_status():
    return analysis_adapter.get_analysis_status()


@router.get("/analytics/weekly-matches")
def weekly_matches():
    return analysis_adapter.get_weekly_matches()


@router.get("/analytics/popular-subjects")
def popular_subjects():
    return analysis_adapter.get_popular_subjects()


@router.get("/analytics/popular-time-slots")
def popular_time_slots():
    return analysis_adapter.get_popular_time_slots()


@router.get("/analytics/mentor-response-rates")
def mentor_response_rates():
    return analysis_adapter.get_mentor_response_rates()
