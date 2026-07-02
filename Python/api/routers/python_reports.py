from fastapi import APIRouter

from api.adapters import reports_adapter

router = APIRouter()


@router.get("/python-reports/status")
def python_reports_status():
    return reports_adapter.get_reports_status()


@router.get("/python-reports/summary")
def python_reports_summary():
    return reports_adapter.get_signup_summary()
