import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent


def test_supervisor_stops_peer_when_a_child_exits(tmp_path):
    marker = tmp_path / 'peer-stopped'
    fixture = tmp_path / 'supervise.py'
    fixture.write_text('''import importlib.util, sys
spec = importlib.util.spec_from_file_location('runtime', sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
peer = "import signal,time,sys; signal.signal(signal.SIGTERM, lambda *a: (open(sys.argv[1],'w').write('stopped'),sys.exit(0))); time.sleep(30)"
raise SystemExit(module.supervise([[sys.executable, '-c', peer, sys.argv[2]], [sys.executable, '-c', 'import time; time.sleep(.3); raise SystemExit(7)']]))
''')
    start = time.monotonic()
    result = subprocess.run([sys.executable, str(fixture), str(ROOT/'ops/run-service.py'), str(marker)], capture_output=True, timeout=5)
    assert result.returncode == 1
    assert marker.read_text() == 'stopped'
    assert time.monotonic() - start < 5


def test_production_runtime_requires_settings_without_printing_secrets():
    result = subprocess.run([sys.executable, str(ROOT/'ops/run-service.py')], env={**os.environ, 'NODE_ENV':'production', 'SESSION_SECRET':'do-not-print-this', 'DATABASE_URL':''}, capture_output=True, text=True)
    assert result.returncode != 0
    assert 'SESSION_SECRET' in result.stderr or 'DATABASE_URL' in result.stderr
    assert 'do-not-print-this' not in result.stderr
