"""Expose signup reporting module results without substitute SQL aggregates."""
from api.adapters.probe import probe_student_call, student_envelope, student_status_envelope


def get_reports_status():
    envelope = student_status_envelope("python_reports.status", probe_student_call("reports"))
    if envelope["ok"]:
        envelope["source"] = "student-module"
    return envelope


def _normalize_summary(result):
    keys = ("today", "thisMonth", "thisYear", "total")
    if not isinstance(result, dict) or any(type(result.get(key)) is not int or result[key] < 0 for key in keys):
        return None
    return {key: result[key] for key in keys}


def get_signup_summary():
    probe = probe_student_call("reports", "signup_summary")
    envelope = student_envelope("python_reports.summary", probe, normalize=_normalize_summary)
    if envelope["ok"]:
        envelope["source"] = "student-module"
    return envelope
