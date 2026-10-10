"""Expose moderation module results without substitute SQL aggregates."""
from api.adapters.probe import probe_student_call, student_envelope


def get_flagged_users():
    probe = probe_student_call("get_blocks", "get_flagged_users")
    envelope = student_envelope(
        "admin.flagged_users", probe,
        normalize=lambda result: result if isinstance(result, list) else None,
    )
    if envelope["ok"]:
        envelope["source"] = "student-module"
    return envelope
