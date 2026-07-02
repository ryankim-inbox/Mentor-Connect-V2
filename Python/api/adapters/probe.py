"""
Shared helpers for wrapping the student practice modules in Python/.

The student files (analysis.py, reports.py, scheduling.py, get_blocks.py, ...)
must never be edited, so every endpoint that depends on one re-imports the
module at request time (same pattern as integration_api). When the student
module cannot be imported or its function fails, the endpoint still answers
with real data computed by the adapter, labeled source="adapter-fallback".
As soon as the student file works, the same endpoint switches to
source="student-module" without a server restart.
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
