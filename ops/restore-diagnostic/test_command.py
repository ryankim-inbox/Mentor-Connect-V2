import hashlib
import importlib.util
import os
import select
import signal
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('diagnostic_builder',Path(__file__).with_name('build_bundle.py'))
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

class CommandTests(unittest.TestCase):
    def test_wrapper_forwards_termination_and_waits_for_owned_child_cleanup(self):
        for termination,exit_code in [(signal.SIGTERM,143),(signal.SIGHUP,129),(signal.SIGINT,130)]:
            with self.subTest(signal=termination),tempfile.TemporaryDirectory(prefix='diagnostic-signal-command-') as temporary:
                root=Path(temporary);launcher=root/'fake.py';wrapper=root/'diagnose.command';marker=root/'cleaned'
                source='''import pathlib,signal,time
def main():
 stopped=False
 def stop(signum,frame):
  nonlocal stopped
  stopped=True
 signal.signal(signal.SIGTERM,stop)
 print("FAKE_CHILD_READY",flush=True)
 while not stopped:time.sleep(.01)
 time.sleep(.1)
 pathlib.Path(MARKER).write_text("cleaned")
 print("FAKE_CHILD_CLEANED",flush=True)
 return 2
'''.replace('MARKER',repr(str(marker)))
                launcher.write_text(source)
                builder.write_wrapper(wrapper,Path(sys.executable).resolve(),launcher,hashlib.sha256(source.encode()).hexdigest(),root/'manifest.json','a'*64)
                child=subprocess.Popen(['/usr/bin/env','-i','/bin/sh',str(wrapper)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
                try:
                    self.assertTrue(select.select([child.stdout],[],[],5)[0])
                    self.assertEqual(child.stdout.readline().strip(),'LOCAL_DIAGNOSTIC_WRAPPER_STARTED')
                    self.assertEqual(child.stdout.readline().strip(),'FAKE_CHILD_READY')
                    child.send_signal(termination)
                    output,error=child.communicate(timeout=5)
                    self.assertEqual(child.returncode,exit_code,error)
                    self.assertEqual(marker.read_text(),'cleaned')
                    self.assertEqual(output.splitlines(),['FAKE_CHILD_CLEANED','LOCAL_DIAGNOSTIC_WRAPPER_EXIT='+str(exit_code)])
                finally:
                    if child.poll() is None or not marker.exists():
                        try:os.killpg(child.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                        child.wait()

    def test_short_wrapper_explicitly_calls_main_and_reports_all_exits(self):
        with tempfile.TemporaryDirectory(prefix='diagnostic-short-command-') as temporary:
            root=Path(temporary);launcher=root/'fake launcher.py';wrapper=root/'diagnose.command';marker=root/'marker'
            source='import pathlib\ndef main():\n pathlib.Path('+repr(str(marker))+').write_text("called")\n print("FAKE_MAIN_CALLED",flush=True)\n return 0\n'
            launcher.write_text(source)
            builder.write_wrapper(wrapper,Path(sys.executable).resolve(),launcher,hashlib.sha256(source.encode()).hexdigest(),root/'manifest.json','a'*64)
            command=['/usr/bin/env','-i','/bin/sh',str(wrapper)]
            result=subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(result.stdout.splitlines(),['LOCAL_DIAGNOSTIC_WRAPPER_STARTED','FAKE_MAIN_CALLED','LOCAL_DIAGNOSTIC_WRAPPER_EXIT=0'])
            self.assertEqual(marker.read_text(),'called')
            marker.unlink();launcher.write_text(source+'# modified\n')
            changed=subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(changed.returncode,2)
            self.assertIn('LOCAL_DIAGNOSTIC_LAUNCHER_HASH_MISMATCH',changed.stdout)
            self.assertEqual(changed.stdout.splitlines()[-1],'LOCAL_DIAGNOSTIC_WRAPPER_EXIT=2');self.assertFalse(marker.exists())

    def test_command_clears_environment_and_refuses_changed_launcher_before_execution(self):
        with tempfile.TemporaryDirectory(prefix='diagnostic-command-') as temporary:
            root=Path(temporary);launcher=root/'fake launcher.py';marker=root/'marker'
            source="import os,pathlib\nassert 'PGPASSWORD' not in os.environ\nassert 'PRIVATE_CANARY' not in os.environ\npathlib.Path("+repr(str(marker))+").write_text('SAFE')\n"
            launcher.write_text(source);checksum=hashlib.sha256(source.encode()).hexdigest()
            command=builder.execution_command(Path(sys.executable).resolve(),launcher,checksum,root/'fake manifest.json','a'*64)
            environment={**os.environ,'PGPASSWORD':'FAKE_PASSWORD_CANARY','PRIVATE_CANARY':'FAKE_VALUE'}
            result=subprocess.run(['/bin/sh','-c',command],env=environment,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(marker.read_text(),'SAFE')
            marker.unlink();launcher.write_text(source+'raise RuntimeError("should not run")')
            changed=subprocess.run(['/bin/sh','-c',command],env=environment,capture_output=True,text=True)
            self.assertNotEqual(changed.returncode,0);self.assertIn('DIAGNOSTIC_LAUNCHER_HASH_MISMATCH',changed.stderr);self.assertFalse(marker.exists())

if __name__=='__main__':unittest.main()
