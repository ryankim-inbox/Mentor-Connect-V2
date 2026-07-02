"""
Proves the Analytics and Scheduling adapters are python-only:

- When the student Python files fail (the checked-in analysis.py has a real
  syntax error), the endpoints report that error with data=None — no
  DB-derived or otherwise fabricated fallback data.
- When the student functions succeed, exactly their output is returned.
- The runtime UI code no longer contains the "Adapter fallback" label.

The student files in Python/ are exercised as-is and never modified.
"""

import re
import types
from contextlib import contextmanager
from pathlib import Path

import integration_api
from api.adapters import analysis_adapter, scheduling_adapter

REPO_ROOT = Path(__file__).resolve().parent.parent

ENVELOPE_KEYS = {
    "ok",
    "success",
    "feature",
    "source",
    "student_module",
    "student_result",
    "error",
    "data",
}


def fake_module(name: str, **functions):
    module = types.ModuleType(name)
    for function_name, function in functions.items():
        setattr(module, function_name, function)
    return module


def patch_student_module(monkeypatch, module):
    monkeypatch.setattr(
        integration_api, "_import_student_module", lambda name: (module, None)
    )


# --- failure paths against the real (broken) student files -----------------


def test_analytics_endpoints_surface_python_error_without_fallback():
    # Python/analysis.py currently has a syntax error on line 27; every
    # analysis-backed endpoint must report it and return no data at all.
    for endpoint in (
        analysis_adapter.get_analysis_status,
        analysis_adapter.get_weekly_matches,
        analysis_adapter.get_popular_subjects,
        analysis_adapter.get_mentor_response_rates,
    ):
        envelope = endpoint()
        assert ENVELOPE_KEYS <= set(envelope)
        assert envelope["source"] == "python"
        assert envelope["success"] is False
        assert envelope["ok"] is False
        assert envelope["data"] is None
        assert "SyntaxError" in envelope["error"]


def test_time_slot_endpoints_surface_scheduling_runtime_error():
    # Python/scheduling.py imports, but receive_time_data() fails at call time
    # (connects to a non-existent host). No substitute slot data is allowed.
    for endpoint in (
        analysis_adapter.get_popular_time_slots,
        scheduling_adapter.get_overview,
    ):
        envelope = endpoint()
        assert envelope["source"] == "python"
        assert envelope["success"] is False
        assert envelope["data"] is None
        assert envelope["error"]
        assert envelope["student_module"]["status"] == "runtime error"


def test_scheduling_status_reports_import_ok():
    envelope = scheduling_adapter.get_scheduling_status()
    assert envelope["source"] == "python"
    assert envelope["success"] is True
    assert envelope["data"] is None
    assert envelope["student_module"]["importable"] is True


# --- success paths use exactly the student output ---------------------------


def test_popular_subjects_success_uses_student_output(monkeypatch):
    patch_student_module(
        monkeypatch,
        fake_module(
            "analysis",
            receive_most_popular_subject=lambda: [
                {"subject": "Math", "requests": 7},
                {"subject": "Physics", "requests": 3, "color": "#123456"},
            ],
        ),
    )
    envelope = analysis_adapter.get_popular_subjects()
    assert envelope["success"] is True
    assert envelope["source"] == "python"
    assert [item["subject"] for item in envelope["data"]] == ["Math", "Physics"]
    assert [item["requests"] for item in envelope["data"]] == [7, 3]
    assert envelope["data"][1]["color"] == "#123456"


def test_missing_weekly_function_is_an_error_not_fallback(monkeypatch):
    # An importable analysis.py without receive_weekly_matches() must yield a
    # "missing function" error instead of DB-computed weekly numbers.
    patch_student_module(monkeypatch, fake_module("analysis"))
    envelope = analysis_adapter.get_weekly_matches()
    assert envelope["success"] is False
    assert envelope["data"] is None
    assert envelope["student_module"]["status"] == "missing function"
    assert "receive_weekly_matches" in envelope["error"]


def test_unusable_student_output_is_an_error_not_fallback(monkeypatch):
    patch_student_module(
        monkeypatch,
        fake_module("analysis", receive_most_popular_subject=lambda: "Math"),
    )
    envelope = analysis_adapter.get_popular_subjects()
    assert envelope["success"] is False
    assert envelope["data"] is None
    assert envelope["student_module"]["status"] == "invalid output"
    # The raw student result stays visible for debugging, but not as data.
    assert envelope["student_result"] == "Math"


def test_overview_success_normalizes_student_rows(monkeypatch):
    patch_student_module(
        monkeypatch,
        fake_module(
            "scheduling",
            receive_time_data=lambda: [("Mon 5pm", 4), ("Tue 6pm", 2)],
        ),
    )
    envelope = scheduling_adapter.get_overview()
    assert envelope["success"] is True
    assert envelope["data"] == {
        "topSlots": [
            {"slot": "Mon 5pm", "count": 4},
            {"slot": "Tue 6pm", "count": 2},
        ]
    }


# --- suggest_times: DB provides only the inputs -----------------------------


class FakeCursor:
    def __init__(self, rows):
        self._rows = list(rows)

    def execute(self, query, params=None):
        pass

    def fetchone(self):
        return self._rows.pop(0)


def patch_users(monkeypatch, row_a, row_b):
    @contextmanager
    def fake_db():
        conn = types.SimpleNamespace(cursor=lambda: FakeCursor([row_a, row_b]))
        yield conn

    monkeypatch.setattr(scheduling_adapter, "db", fake_db)


USER_A = {"id": 1, "name": "Ada", "role": "student", "available_times": ["Mon 5pm", "Tue 6pm"]}
USER_B = {"id": 2, "name": "Grace", "role": "mentor", "available_times": ["Tue 6pm", "Wed 7pm"]}


def test_suggest_times_returns_only_python_overlap(monkeypatch):
    patch_users(monkeypatch, USER_A, USER_B)
    patch_student_module(
        monkeypatch,
        fake_module("scheduling", time_dict=lambda student, teacher: ["Mon 5pm"]),
    )
    envelope = scheduling_adapter.suggest_times(1, 2)
    assert envelope["success"] is True
    assert envelope["source"] == "python"
    # Both users share "Tue 6pm", but the displayed overlap must be exactly
    # what the student function returned — no adapter set-intersection.
    assert envelope["data"]["overlap"] == ["Mon 5pm"]


def test_suggest_times_failure_has_no_computed_overlap(monkeypatch):
    patch_users(monkeypatch, USER_A, USER_B)

    def broken_time_dict(student, teacher):
        raise NameError("name 'time' is not defined")

    patch_student_module(monkeypatch, fake_module("scheduling", time_dict=broken_time_dict))
    envelope = scheduling_adapter.suggest_times(1, 2)
    # The users overlap on "Tue 6pm", but the adapter must not compute it.
    assert envelope["success"] is False
    assert envelope["data"] is None
    assert envelope["student_module"]["status"] == "runtime error"
    assert "NameError" in envelope["error"]


# --- no fallback labels or fallback code paths left in runtime code ---------


def test_no_adapter_fallback_label_in_frontend():
    src = REPO_ROOT / "artifacts" / "peerbridge" / "src"
    pattern = re.compile(r"adapter fallback|real DB data", re.IGNORECASE)
    offenders = [
        str(path.relative_to(REPO_ROOT))
        for path in src.rglob("*")
        if path.suffix in {".ts", ".tsx"} and pattern.search(path.read_text())
    ]
    assert offenders == []


def test_analytics_and_scheduling_adapters_have_no_fallback_paths():
    adapters_dir = REPO_ROOT / "Python" / "api" / "adapters"
    for name in ("analysis_adapter.py", "scheduling_adapter.py"):
        source = (adapters_dir / name).read_text()
        assert "adapter-fallback" not in source
        assert "fallback_data" not in source
    # The analytics adapter must not read the product database at all.
    assert "from db import" not in (adapters_dir / "analysis_adapter.py").read_text()
