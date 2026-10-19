import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
import io
import json
import subprocess
import sys
import os
import signal

spec=importlib.util.spec_from_file_location('restore_diagnostic_launcher',pathlib.Path(__file__).with_name('launcher.py'))
launcher=importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class LauncherTests(unittest.TestCase):
    def test_relation_analysis_accepts_only_bounded_field_names_and_counts(self):
        detail={'status':'complete','sourceCount':3,'restoredCount':3,'missingCount':0,'addedCount':0,'changedCount':3,'changedFields':['relacl'],'orderChanged':False,'aclDefaultEquivalentCount':3,'aclEncodingEquivalentCount':0,'aclPrivilegeDifferenceCount':0,'aclUnclassifiedCount':0,'sourceExplicitToNullCount':3,'sourceNullToExplicitCount':0}
        result={'status':'LOCAL_RESTORE_DIFFERENCE','failedStage':'proof-compare','category':'PROOF_DIFFERENCE','cleanup':'ok','mismatchFields':['schema.relations'],'relationAnalysis':detail}
        self.assertEqual(launcher.safe_result(result),result)
        self.assertEqual(launcher.safe_result({**result,'relationAnalysis':{'status':'unavailable'}})['relationAnalysis'],{'status':'unavailable'})
        for invalid in [{**detail,'raw':'PRIVATE_CANARY'},{**detail,'changedFields':['PRIVATE_CANARY']},{**detail,'changedCount':1025},{**detail,'changedCount':True},{**detail,'orderChanged':'false'},{**detail,'sourceExplicitToNullCount':0}]:
            with self.assertRaises(ValueError):launcher.safe_result({**result,'relationAnalysis':invalid})
        with self.assertRaises(ValueError):launcher.safe_result({**result,'status':'LOCAL_RESTORE_MATCH','mismatchFields':[]})

    def test_termination_and_hangup_finish_supervisor_cleanup(self):
        for termination in [signal.SIGTERM,signal.SIGHUP]:
            with self.subTest(signal=termination),tempfile.TemporaryDirectory() as temporary:
                root=pathlib.Path(temporary);marker=root/'cleaned';source=pathlib.Path(__file__).with_name('launcher.py').resolve()
                script='''import importlib.util,json,os,pathlib,signal,sys
spec=importlib.util.spec_from_file_location('launcher',SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
manifest={'node':'/fake/node','bundleRoot':'/fake/bundle','config':{'workDirectory':WORK,'dumpPath':'/fake/dump','evidencePath':'/fake/evidence'}}
class Child:
 pid=1
 returncode=1
 def __init__(self,*a,**k):os.kill(os.getpid(),SIGNAL)
 def communicate(self,*a,**k):return b'',None
 def poll(self):return 1
m.subprocess.Popen=Child
m.verify_manifest=lambda *a:manifest
def cleanup(*a):
 os.kill(os.getpid(),SIGNAL)
 pathlib.Path(MARKER).write_text('cleaned')
 return 'ok'
m.cleanup_local=cleanup
sys.argv=['launcher','--manifest','fake','--manifest-sha256','a'*64]
sys.exit(m.main())
'''.replace('SOURCE',repr(str(source))).replace('WORK',repr(str(root/'work'))).replace('SIGNAL',str(int(termination))).replace('MARKER',repr(str(marker)))
                result=subprocess.run([sys.executable,'-I','-B','-c',script],capture_output=True,text=True,timeout=5)
                self.assertEqual(result.returncode,2,result.stderr)
                self.assertEqual(marker.read_text(),'cleaned')
                self.assertIn('"cleanup":"ok"',result.stdout)
                self.assertEqual(result.stdout.splitlines()[-1],'LOCAL_DIAGNOSTIC_EXIT=2')
                self.assertEqual(result.stderr,'')

    def test_main_prints_started_and_exit_on_preflight_failure(self):
        result=subprocess.run([sys.executable,'-I','-B',str(pathlib.Path(__file__).with_name('launcher.py')),'--manifest','/nonexistent-fixture','--manifest-sha256','0'*64],capture_output=True,text=True)
        self.assertEqual(result.returncode,2)
        self.assertEqual(result.stdout.splitlines()[0],'LOCAL_DIAGNOSTIC_STARTED')
        self.assertEqual(result.stdout.splitlines()[-1],'LOCAL_DIAGNOSTIC_EXIT=2')
        self.assertEqual(result.stderr,'')

    def test_child_environment_drops_credentials_and_hooks(self):
        environment=launcher.clean_environment()
        self.assertEqual(set(environment),{'PATH','LANG','LC_ALL','PGPASSFILE','PGCONNECT_TIMEOUT'})
        self.assertEqual(environment['PGPASSFILE'],'/dev/null')

    def test_output_filter_rejects_extra_fields_and_raw_values(self):
        good={'status':'LOCAL_RESTORE_FAILED','failedStage':'archive-restore','category':'NATIVE_PERMISSION_DENIED','cleanup':'ok','mismatchFields':[]}
        self.assertEqual(launcher.safe_result(good),good)
        for bad in [{**good,'message':'PRIVATE_CANARY'},{**good,'category':'PRIVATE_CANARY'},{**good,'mismatchFields':['PRIVATE_CANARY']}]:
            with self.assertRaises(ValueError):launcher.safe_result(bad)

    def test_private_file_rejects_symlink_and_hardlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary);root.chmod(0o700)
            data=root/'data';data.write_text('fake');data.chmod(0o600)
            link=root/'link';link.symlink_to(data)
            with self.assertRaises(ValueError):launcher.private_stat(link)
            link.unlink();link.hardlink_to(data)
            with self.assertRaises(ValueError):launcher.private_stat(data)

    def test_abnormal_node_exit_cleans_fake_local_data_and_never_prints_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary);work=root/'work'
            original=root/'original';original.write_text('PRESERVE')
            manifest={'node':'/fake/node','bundleRoot':str(root/'bundle'),'pgBin':'/fake/pg','config':{'workDirectory':str(work),'dumpPath':str(original),'evidencePath':str(root/'fake-evidence')}}
            class FailedChild:
                pid=12345
                returncode=1
                def __init__(self,*args,**kwargs):
                    (work/'cluster').mkdir();(work/'cluster/private').write_text('PRIVATE_CANARY');(work/'server.log').write_text('PRIVATE_CANARY')
                def communicate(self,*args,**kwargs):return b'',None
                def poll(self):return 1
            output=io.StringIO()
            with patch.object(launcher.subprocess,'Popen',FailedChild),redirect_stdout(output):
                self.assertEqual(launcher.execute(manifest),2)
            result=json.loads(output.getvalue());self.assertEqual(result['cleanup'],'ok');self.assertEqual(result['status'],'LOCAL_RESTORE_FAILED')
            self.assertNotIn('PRIVATE_CANARY',output.getvalue());self.assertFalse((work/'cluster').exists());self.assertFalse((work/'server.log').exists());self.assertEqual(original.read_text(),'PRESERVE')

    def test_symlink_cluster_is_rejected_before_any_process_control(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary);work=root/'work';work.mkdir(mode=0o700)
            other=root/'other';other.mkdir();(other/'PG_VERSION').write_text('18')
            (work/'cluster').symlink_to(other,target_is_directory=True)
            with patch.object(launcher.subprocess,'run',side_effect=AssertionError('must not control external cluster')):
                self.assertEqual(launcher.cleanup_local({'config':{'workDirectory':str(work)}}),'failed')
            self.assertTrue((other/'PG_VERSION').exists())

if __name__=='__main__':unittest.main()
