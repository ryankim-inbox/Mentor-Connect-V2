import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, current_thread
from types import SimpleNamespace

import integration_api
from api.adapters.probe import probe_student_call


def test_reload_critical_section_is_serialized(monkeypatch):
    first_import = Event()
    second_attempt = Event()
    second_invalidation = Event()
    release_first = Event()
    sequence = []

    class Modules(dict):
        def pop(self, name, default=None):
            sequence.append((current_thread().name, "pop"))
            return super().pop(name, default)

    def invalidate():
        sequence.append((current_thread().name, "invalidate"))
        if first_import.is_set():
            second_invalidation.set()

    def import_module(name):
        sequence.append((current_thread().name, "import"))
        if not first_import.is_set():
            first_import.set()
            assert release_first.wait(5)
        sequence.append((current_thread().name, "return"))
        return SimpleNamespace(__name__=name)

    def competing_reload():
        second_attempt.set()
        return integration_api._import_student_module("analysis")

    monkeypatch.setattr(integration_api, "sys", SimpleNamespace(modules=Modules()))
    monkeypatch.setattr(integration_api, "invalidate_caches", invalidate)
    monkeypatch.setattr(integration_api, "import_module", import_module)
    with ThreadPoolExecutor(max_workers=2) as workers:
        first = workers.submit(integration_api._import_student_module, "analysis")
        try:
            assert first_import.wait(5)
            second = workers.submit(competing_reload)
            assert second_attempt.wait(5)
            interleaved = second_invalidation.wait(0.5)
        finally:
            release_first.set()
        for future in (first, second):
            module, error = future.result(timeout=5)
            assert module.__name__ == "analysis"
            assert error is None
    assert not interleaved
    assert [step for _, step in sequence] == ["invalidate", "pop", "import", "return"] * 2
    assert len({thread for thread, _ in sequence[:4]}) == 1
    assert len({thread for thread, _ in sequence[4:]}) == 1


_RELOAD_STRESS_SCRIPT = '''
from concurrent.futures import ThreadPoolExecutor
import integration_api

def reload_repeatedly():
    for _ in range(200):
        module, error = integration_api._import_student_module("analysis")
        assert error is None, error
        assert callable(module.receive_most_popular_subject)
        assert callable(module.receive_mentor_ranks)

with ThreadPoolExecutor(max_workers=20) as workers:
    futures = [workers.submit(reload_repeatedly) for _ in range(20)]
    for future in futures:
        future.result()
print("4000 imports completed")
'''


def test_real_analysis_reload_stress():
    # A process deadline also bounds executor shutdown if a reload worker deadlocks.
    result = subprocess.run(
        [sys.executable, "-c", _RELOAD_STRESS_SCRIPT],
        cwd=Path(__file__).resolve().parent.parent / "Python",
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.strip() == "4000 imports completed"


def test_reload_observes_edited_module(monkeypatch, tmp_path):
    name = "edited_student_lesson"
    source = tmp_path / f"{name}.py"
    monkeypatch.syspath_prepend(str(tmp_path))
    try:
        source.write_text("value = 'before'\n")
        before, error = integration_api._import_student_module(name)
        assert error is None
        assert before.value == "before"
        # A different file size also invalidates Python's timestamp-based bytecode cache.
        source.write_text("value = 'after editing'\n")
        after, error = integration_api._import_student_module(name)
        assert error is None
        assert after.value == "after editing"
        assert after is not before
    finally:
        sys.modules.pop(name, None)


def test_student_calls_run_outside_reload_lock(monkeypatch):
    first_call = Event()
    release_first = Event()

    def student_function(wait):
        if wait:
            first_call.set()
            assert release_first.wait(5)
        return "student result"

    module = SimpleNamespace(run=student_function)
    monkeypatch.setattr(integration_api, "import_module", lambda name: module)
    with ThreadPoolExecutor(max_workers=2) as workers:
        first = workers.submit(probe_student_call, "analysis", "run", (True,))
        try:
            assert first_call.wait(5)
            second = workers.submit(probe_student_call, "analysis", "run", (False,))
            assert second.result(timeout=2)["result"] == "student result"
        finally:
            release_first.set()
        assert first.result(timeout=5)["result"] == "student result"
