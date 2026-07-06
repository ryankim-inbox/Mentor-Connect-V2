
from __future__ import annotations

import inspect
import sys
from importlib import import_module, invalidate_caches
from typing import Any


ALLOWED_RAW_MODULES = {"find_matches", "locations", "get_blocks"}


def _error_status(error: BaseException) -> str:
    if isinstance(error, SyntaxError):
        return "syntax error"
    if isinstance(error, (ImportError, ModuleNotFoundError)):
        return "import error"
    return "import error"


def _safe_error(
    feature: str,
    module_name: str,
    message: str,
    error: BaseException,
) -> dict[str, Any]:
    return {
        "success": False,
        "feature": feature,
        "module_name": module_name,
        "status": _error_status(error),
        "message": message,
        "error": f"{type(error).__name__}: {error}",
        "available_functions": [],
        "is_todo": False,
        "is_real": False,
    }


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    return repr(value)


def _import_student_module(module_name: str) -> tuple[Any | None, dict[str, Any] | None]:
    invalidate_caches()
    sys.modules.pop(module_name, None)

    try:
        return import_module(module_name), None
    except Exception as error:
        return None, _safe_error(
            feature=module_name,
            module_name=module_name,
            message=f"{module_name}.py could not be imported yet.",
            error=error,
        )


def _available_functions(module: Any, module_name: str) -> list[str]:
    functions: list[str] = []
    for name, value in inspect.getmembers(module, inspect.isfunction):
        if name.startswith("_"):
            continue
        if getattr(value, "__module__", None) == module_name:
            functions.append(name)
    return sorted(functions)


def get_raw_module_metadata(module_name: str) -> dict[str, Any]:
    """
    Return safe import metadata for a whitelisted student module.
    """
    if module_name not in ALLOWED_RAW_MODULES:
        return {
            "success": False,
            "feature": "raw",
            "module_name": module_name,
            "status": "unavailable",
            "message": "Only find_matches, locations, and get_blocks can be inspected.",
            "available_functions": [],
            "is_todo": False,
            "is_real": False,
        }

    module, error_response = _import_student_module(module_name)
    if error_response:
        error_response["feature"] = "raw"
        return error_response

    return {
        "success": True,
        "feature": "raw",
        "module_name": module_name,
        "status": "connected",
        "message": f"{module_name}.py imported successfully.",
        "available_functions": _available_functions(module, module_name),
        "is_todo": False,
        "is_real": True,
    }


def _call_with_clear_args(function: Any, positional_args: list[Any], keyword_args: dict[str, Any]) -> Any:
    try:
        signature = inspect.signature(function)
        parameters = signature.parameters
        if all(name in parameters for name in keyword_args):
            return function(**keyword_args)
    except (TypeError, ValueError):
        pass

    return function(*positional_args)


def get_matching_result(question_id: int, limit: int = 5) -> dict[str, Any]:
    """
    Call find_matches.find_matches if the student has implemented it.
    """
    module, error_response = _import_student_module("find_matches")
    if error_response:
        error_response.update(
            {
                "feature": "matching",
                "question_id": question_id,
                "limit": limit,
                "matches": [],
                "message": "find_matches.py could not be imported yet.",
            }
        )
        return error_response

    available = _available_functions(module, "find_matches")
    find_matches = getattr(module, "find_matches", None)
    if not callable(find_matches):
        return {
            "success": False,
            "feature": "matching",
            "module_name": "find_matches",
            "status": "missing function",
            "question_id": question_id,
            "limit": limit,
            "matches": [],
            "available_functions": available,
            "message": "find_matches.py does not define a callable find_matches(question_id, limit) yet.",
            "is_todo": True,
            "is_real": False,
        }

    try:
        result = _call_with_clear_args(
            find_matches,
            [question_id, limit],
            {"question_id": question_id, "limit": limit},
        )
    except Exception as error:
        return {
            "success": False,
            "feature": "matching",
            "module_name": "find_matches",
            "status": "runtime error",
            "question_id": question_id,
            "limit": limit,
            "matches": [],
            "available_functions": available,
            "message": "find_matches.py imported, but find_matches failed while running.",
            "error": f"{type(error).__name__}: {error}",
            "is_todo": False,
            "is_real": False,
        }

    if isinstance(result, dict):
        safe_result = _json_safe(result)
        safe_result.setdefault("success", True)
        safe_result.setdefault("feature", "matching")
        safe_result.setdefault("module_name", "find_matches")
        safe_result.setdefault("status", "connected")
        safe_result.setdefault("question_id", question_id)
        safe_result.setdefault("limit", limit)
        safe_result.setdefault("matches", [])
        safe_result.setdefault("available_functions", available)
        safe_result.setdefault("message", "Matches returned by find_matches.py.")
        safe_result["is_todo"] = False
        safe_result["is_real"] = True
        return safe_result

    if isinstance(result, list):
        return {
            "success": True,
            "feature": "matching",
            "module_name": "find_matches",
            "status": "connected",
            "question_id": question_id,
            "limit": limit,
            "matches": _json_safe(result),
            "available_functions": available,
            "message": "Matches returned by find_matches.py.",
            "is_todo": False,
            "is_real": True,
        }

    return {
        "success": False,
        "feature": "matching",
        "module_name": "find_matches",
        "status": "runtime error",
        "question_id": question_id,
        "limit": limit,
        "matches": [],
        "available_functions": available,
        "message": "find_matches.py returned a value, but it was not a JSON object or list.",
        "raw_result_type": type(result).__name__,
        "raw_result": _json_safe(result),
        "is_todo": False,
        "is_real": False,
    }


def get_location_status() -> dict[str, Any]:
    """
    Report whether locations.py can currently be imported.
    """
    module, error_response = _import_student_module("locations")
    if error_response:
        error_response.update(
            {
                "feature": "locations",
                "message": "locations.py could not be imported yet.",
            }
        )
        return error_response

    available = _available_functions(module, "locations")
    return {
        "success": True,
        "feature": "locations",
        "module_name": "locations",
        "status": "connected" if available else "todo/not implemented",
        "message": "locations.py imported successfully."
        if available
        else "locations.py imported, but no public callable helper functions were detected.",
        "available_functions": available,
        "is_todo": not available,
        "is_real": bool(available),
    }


def run_location_test(test_input: dict[str, Any]) -> dict[str, Any]:
    """
    Run a location helper only when the input clearly matches an obvious helper.
    """
    module, error_response = _import_student_module("locations")
    if error_response:
        error_response.update(
            {
                "feature": "locations",
                "message": "locations.py could not be imported yet.",
                "input": _json_safe(test_input),
            }
        )
        return error_response

    available = _available_functions(module, "locations")
    location_data = getattr(module, "location_data", None)

    if callable(location_data) and all(key in test_input for key in ("student", "mentor", "question")):
        try:
            result = location_data(
                test_input["student"],
                test_input["mentor"],
                test_input["question"],
            )
            return {
                "success": True,
                "feature": "locations",
                "module_name": "locations",
                "status": "connected",
                "function_called": "location_data",
                "available_functions": available,
                "message": "locations.location_data returned a result.",
                "result": _json_safe(result),
                "is_todo": False,
                "is_real": True,
            }
        except Exception as error:
            return {
                "success": False,
                "feature": "locations",
                "module_name": "locations",
                "status": "runtime error",
                "function_called": "location_data",
                "available_functions": available,
                "message": "locations.py imported, but location_data failed while running.",
                "error": f"{type(error).__name__}: {error}",
                "input": _json_safe(test_input),
                "is_todo": False,
                "is_real": False,
            }

    return {
        "success": False,
        "feature": "locations",
        "module_name": "locations",
        "status": "missing function",
        "available_functions": available,
        "message": (
            "No callable location test function was detected for this input. "
            "Provide student, mentor, and question objects to test location_data if it exists."
        ),
        "input": _json_safe(test_input),
        "is_todo": True,
        "is_real": False,
    }


def get_block_status() -> dict[str, Any]:
    """
    Report whether get_blocks.py can currently be imported and inspected.
    """
    module, error_response = _import_student_module("get_blocks")
    if error_response:
        error_response.update(
            {
                "feature": "blocks",
                "message": "get_blocks.py could not be imported yet.",
            }
        )
        return error_response

    available = _available_functions(module, "get_blocks")
    can_filter_matches = callable(getattr(module, "prevent_matches", None))

    return {
        "success": True,
        "feature": "blocks",
        "module_name": "get_blocks",
        "status": "connected" if can_filter_matches else "todo/not implemented",
        "service_available": can_filter_matches,
        "blocked_users_excluded": can_filter_matches,
        "available_functions": available,
        "message": "get_blocks.py imported successfully.",
        "is_todo": not can_filter_matches,
        "is_real": can_filter_matches,
    }


def get_practice_status() -> dict[str, Any]:
    """
    Return overall status for all student practice engines.
    """
    matching_metadata = get_raw_module_metadata("find_matches")
    matching_status = {
        **matching_metadata,
        "feature": "matching",
        "status": "connected"
        if matching_metadata.get("success") and "find_matches" in matching_metadata.get("available_functions", [])
        else "missing function"
        if matching_metadata.get("success")
        else matching_metadata.get("status", "unavailable"),
        "is_todo": bool(matching_metadata.get("success"))
        and "find_matches" not in matching_metadata.get("available_functions", []),
        "is_real": bool(matching_metadata.get("success"))
        and "find_matches" in matching_metadata.get("available_functions", []),
        "message": "find_matches.py is importable and find_matches is available."
        if matching_metadata.get("success") and "find_matches" in matching_metadata.get("available_functions", [])
        else matching_metadata.get("message", "find_matches.py status unavailable."),
    }

    return {
        "success": True,
        "feature": "practice",
        "status": "connected",
        "message": "Python practice API is running. Individual engine statuses are listed below.",
        "engines": {
            "matching": matching_status,
            "locations": get_location_status(),
            "blocks": get_block_status(),
        },
    }
