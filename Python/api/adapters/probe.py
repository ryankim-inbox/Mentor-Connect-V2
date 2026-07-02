"""
Shared helpers for wrapping the student practice modules in Python/.

The student files (analysis.py, reports.py, scheduling.py, get_blocks.py, ...)
must never be edited, so every endpoint that depends on one re-imports the
module at request time (same pattern as integration_api).

Analytics and scheduling endpoints use student_envelope/student_status_envelope:
the student module is the only source of data (source="python"), and any
import/call/output failure is reported as an error instead of being replaced
by adapter-computed numbers.

make_envelope keeps the older fallback behavior and remains only for the
admin/reports endpoints, which are outside the python-only requirement.
"""

from __future__ import annotations

from typing import Any, Callable

import integration_api


def probe_student_call(
    module_name: str,
    function_name: str | None = None,
    args: tuple = (),
    kwargs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Try to import a student module and optionally call one of its functions.

    Never raises; the outcome is described in the returned dict:
    {module, attempted_function, importable, called, status, error,
     available_functions, result}
    """
    probe: dict[str, Any] = {
        "module": module_name,
        "attempted_function": function_name,
        "importable": False,
        "called": False,
        "status": "unknown",
        "error": None,
        "available_functions": [],
        "result": None,
    }

    module, import_error = integration_api._import_student_module(module_name)
    if import_error:
        probe["status"] = import_error.get("status", "import error")
        probe["error"] = import_error.get("error")
        return probe

    probe["importable"] = True
    probe["available_functions"] = integration_api._available_functions(module, module_name)

    if function_name is None:
        probe["status"] = "import ok"
        return probe

    function = getattr(module, function_name, None)
    if not callable(function):
        probe["status"] = "missing function"
        probe["error"] = f"{module_name}.py does not define a callable {function_name}()."
        return probe

    try:
        probe["result"] = function(*args, **(kwargs or {}))
        probe["called"] = True
        probe["status"] = "called"
    except Exception as error:
        probe["status"] = "runtime error"
        probe["error"] = f"{type(error).__name__}: {error}"
    return probe


def student_module_summary(probe: dict[str, Any]) -> dict[str, Any]:
    """Envelope-friendly view of a probe (drops the raw result)."""
    return {
        "module": probe["module"],
        "attempted_function": probe["attempted_function"],
        "importable": probe["importable"],
        "called": probe["called"],
        "status": probe["status"],
        "error": probe["error"],
        "available_functions": probe["available_functions"],
    }


def student_status_envelope(feature: str, probe: dict[str, Any]) -> dict[str, Any]:
    """
    Envelope for import-status endpoints. Succeeds only when the student
    module imports; there is no data payload and no fallback.
    """
    return {
        "ok": probe["importable"],
        "success": probe["importable"],
        "feature": feature,
        "source": "python",
        "student_module": student_module_summary(probe),
        "student_result": None,
        "error": probe["error"],
        "data": None,
    }


def student_envelope(
    feature: str,
    probe: dict[str, Any],
    normalize: Callable[[Any], Any] | None = None,
    invalid_message: str | None = None,
) -> dict[str, Any]:
    """
    Envelope whose data can only come from the student function's output.

    normalize may reshape the raw result for the frontend (or return None to
    mark it unusable); it must never introduce data the student code did not
    produce. On import error, call error, or unusable output, the envelope is
    success=False with data=None and the captured Python error.
    """
    envelope: dict[str, Any] = {
        "ok": False,
        "success": False,
        "feature": feature,
        "source": "python",
        "student_module": student_module_summary(probe),
        "student_result": None,
        "error": None,
        "data": None,
    }

    if not probe["called"]:
        envelope["error"] = (
            probe["error"] or f"{probe['module']}.py did not run ({probe['status']})."
        )
        return envelope

    envelope["student_result"] = integration_api._json_safe(probe["result"])
    normalized = normalize(probe["result"]) if normalize else probe["result"]
    if normalized is None:
        envelope["error"] = invalid_message or (
            f"{probe['module']}.{probe['attempted_function']}() ran, but its return value "
            "is not in a shape this page can display."
        )
        envelope["student_module"]["status"] = "invalid output"
        envelope["student_module"]["error"] = envelope["error"]
        return envelope

    envelope["ok"] = True
    envelope["success"] = True
    envelope["data"] = integration_api._json_safe(normalized)
    return envelope


def make_envelope(
    feature: str,
    probe: dict[str, Any] | None,
    fallback_data: Any,
    normalize: Callable[[Any], Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Build the common adapter response.

    If the student call succeeded and its result normalizes to usable data,
    the response uses it with source="student-module"; otherwise fallback_data
    is returned with source="adapter-fallback". Pass normalize=lambda _: None
    to always keep the fallback while still reporting the student result.
    """
    envelope: dict[str, Any] = {
        "ok": True,
        "feature": feature,
        "source": "adapter-fallback",
        "student_module": student_module_summary(probe) if probe else None,
        "student_result": None,
        "data": fallback_data,
    }

    if probe and probe["called"]:
        envelope["student_result"] = integration_api._json_safe(probe["result"])
        normalized = normalize(probe["result"]) if normalize else probe["result"]
        if normalized is not None:
            envelope["source"] = "student-module"
            envelope["data"] = integration_api._json_safe(normalized)

    if extra:
        envelope.update(extra)
    return envelope
