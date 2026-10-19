"""Only generated files, sockets, and canaries; no actual backup inputs."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import select
import sys
import time
import subprocess
import tempfile
import unittest
import io
from contextlib import redirect_stdout

spec=importlib.util.spec_from_file_location('diagnostic_launcher',Path(__file__).with_name('launcher.py'))
launcher=importlib.util.module_from_spec(spec);spec.loader.exec_module(launcher)
NODE='/Users/rinny/.nvm/versions/node/v24.21.0/bin/node'

class SandboxTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('RUN_LOCAL_RESTORE_DIAGNOSTIC_TEST')=='1','requires local macOS sandbox execution')
    def test_progress_is_visible_while_child_is_still_running(self):
        with tempfile.TemporaryDirectory(prefix='restore-progress-test-',dir='/private/tmp') as temporary:
            root=Path(temporary);bundle=root/'bundle';bundle.mkdir(mode=0o700);work=root/'work'
            script='''const fs=require('node:fs');
fs.writeFileSync('progress.jsonl',JSON.stringify({stage:'archive-restore'})+'\\n',{mode:0o600});
const deadline=setTimeout(()=>process.exit(8),6000);
const timer=setInterval(()=>{if(fs.existsSync('release')){clearInterval(timer);clearTimeout(deadline);console.log(JSON.stringify({status:'LOCAL_RESTORE_MATCH',failedStage:null,category:'MATCH',mismatchFields:[],cleanup:'ok'}));}},20);
'''
            (bundle/'diagnostic.cjs').write_text(script)
            manifest={'node':NODE,'bundleRoot':str(bundle),'pgBin':'/opt/homebrew/opt/postgresql@18/bin','config':{'workDirectory':str(work),'dumpPath':str(root/'fake.dump'),'evidencePath':str(root/'fake.json')}}
            command="import importlib.util,sys;spec=importlib.util.spec_from_file_location('launcher',"+repr(str(Path(__file__).with_name('launcher.py').resolve()))+");m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);sys.exit(m.execute("+repr(manifest)+"))"
            child=subprocess.Popen([sys.executable,'-I','-B','-c',command],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            try:
                deadline=time.monotonic()+5;output=b''
                while b'LOCAL_DIAGNOSTIC_STAGE=archive-restore\n' not in output and time.monotonic()<deadline:
                    if select.select([child.stdout],[],[],.1)[0]:output+=os.read(child.stdout.fileno(),4096)
                self.assertIn(b'LOCAL_DIAGNOSTIC_STAGE=archive-restore\n',output)
                self.assertIsNone(child.poll())
                (work/'release').write_text('continue')
                tail,error=child.communicate(timeout=5)
                self.assertEqual(child.returncode,0,error.decode())
                self.assertEqual((output+tail).count(b'LOCAL_DIAGNOSTIC_STAGE=archive-restore'),1)
                self.assertEqual(json.loads((output+tail).splitlines()[-1])['cleanup'],'ok')
                self.assertEqual(json.loads((work/'supervisor-result.json').read_text())['exitCode'],0)
            finally:
                if work.exists():(work/'release').touch()
                if child.poll() is None:
                    try:child.communicate(timeout=10)
                    except subprocess.TimeoutExpired:child.kill();child.wait()

    @unittest.skipUnless(os.environ.get('RUN_LOCAL_RESTORE_DIAGNOSTIC_TEST')=='1','requires local macOS sandbox execution')
    def test_supervisor_stops_real_fresh_cluster_after_child_abrupt_exit(self):
        with tempfile.TemporaryDirectory(prefix='restore-cleanup-test-',dir='/private/tmp') as temporary:
            root=Path(temporary);bundle=root/'bundle';bundle.mkdir(mode=0o700);work=root/'work'
            pg='/opt/homebrew/opt/postgresql@18/bin'
            script="""const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const work=process.cwd(),pg='/opt/homebrew/opt/postgresql@18/bin';fs.mkdirSync(work+'/s',{mode:0o700});
for(const [bin,args] of [['initdb',['-D',work+'/cluster','--no-locale','--encoding=UTF8','--auth-local=trust','--auth-host=reject']],['pg_ctl',['-D',work+'/cluster','-l',work+'/server.log','-o',`-F -h '' -p 5432 -k ${work}/s`,'-w','start']]]){if(spawnSync(pg+'/'+bin,args,{env:process.env,stdio:'ignore'}).status!==0)process.exit(8);}
fs.writeFileSync(work+'/started','yes');process.exit(7);
"""
            (bundle/'diagnostic.cjs').write_text(script)
            manifest={'node':NODE,'bundleRoot':str(bundle),'pgBin':pg,'config':{'workDirectory':str(work),'dumpPath':str(root/'fake.dump'),'evidencePath':str(root/'fake.json')}}
            output=io.StringIO()
            with redirect_stdout(output):self.assertEqual(launcher.execute(manifest),2)
            self.assertEqual((work/'started').read_text(),'yes')
            result=json.loads(output.getvalue());self.assertEqual(result['cleanup'],'ok');self.assertIsNone(result['failedStage'])
            self.assertFalse((work/'cluster').exists());self.assertFalse((work/'server.log').exists());self.assertFalse((work/'s').exists())

    @unittest.skipUnless(os.environ.get('RUN_LOCAL_RESTORE_DIAGNOSTIC_TEST')=='1','requires local macOS sandbox execution')
    def test_tcp_other_sockets_and_outside_files_are_blocked(self):
        with tempfile.TemporaryDirectory(prefix='restore-boundary-test-',dir='/private/tmp') as temporary:
            root=Path(temporary);work=root/'work';work.mkdir(mode=0o700);(work/'s').mkdir(mode=0o700);bundle=root/'bundle';bundle.mkdir(mode=0o700)
            outside=root/'private-canary';outside.write_text('FAKE_PRIVATE_CANARY');outside.chmod(0o600)
            other=socket.socket(socket.AF_UNIX);other.bind(str(root/'other.sock'));other.listen()
            manifest={'node':NODE,'bundleRoot':str(bundle),'config':{'workDirectory':str(work),'dumpPath':str(root/'fake.dump'),'evidencePath':str(root/'fake.json')}}
            script="""const fs=require('node:fs'),net=require('node:net');
const root=process.argv[1],work=process.argv[2];
function denied(action){try{action();return false;}catch(e){return ['EPERM','EACCES'].includes(e.code);}}
async function connectDenied(target){return await new Promise(resolve=>{const c=net.connect(target);c.once('error',e=>resolve(['EPERM','EACCES'].includes(e.code)));c.once('connect',()=>{c.destroy();resolve(false);});});}
(async()=>{const read=denied(()=>fs.readFileSync(root+'/private-canary')),write=denied(()=>fs.writeFileSync(root+'/outside-write','bad'));fs.writeFileSync(work+'/allowed','safe');const tcp=await connectDenied({host:'127.0.0.1',port:9}),other=await connectDenied(root+'/other.sock');const own=await new Promise(resolve=>{const s=net.createServer(c=>c.end());s.on('error',()=>resolve(false));s.listen(work+'/s/.s.PGSQL.5432',()=>{const c=net.connect(work+'/s/.s.PGSQL.5432');c.on('connect',()=>{c.destroy();s.close(()=>resolve(true));});c.on('error',()=>{s.close();resolve(false);});});});console.log(JSON.stringify({read,write,tcp,other,own}));})()
"""
            try:
                result=subprocess.run(['/usr/bin/sandbox-exec','-p',launcher.sandbox_profile(manifest),NODE,'-e',script,str(root),str(work)],cwd=work,env=launcher.clean_environment(),capture_output=True,text=True,timeout=10)
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(json.loads(result.stdout),{'read':True,'write':True,'tcp':True,'other':True,'own':True})
                self.assertEqual(outside.read_text(),'FAKE_PRIVATE_CANARY');self.assertFalse((root/'outside-write').exists())
            finally:other.close()

if __name__=='__main__':unittest.main()
