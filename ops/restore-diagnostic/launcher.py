#!/usr/bin/env python3
"""User-run local-only diagnostic. No password prompt or remote connection."""
import sys
if __name__=='__main__' and (not sys.flags.isolated or not sys.dont_write_bytecode):
    raise SystemExit('ISOLATED_PYTHON_REQUIRED')
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import shutil
import signal
import stat
import subprocess
import time

STAGES={'input-verification','initdb','server-start','database-prepare','archive-restore','proof-read','proof-compare','server-stop','cleanup'}
FIELDS={'schema.'+x for x in ['catalog','relations','columns','sequences','constraints','policies','functions','grants','defaultGrants','schemas','views','ownership','database']}|{'ledger','rows','passwordDigest','sequences','settings','databaseGrants','triggerStructure'}
CATEGORIES={'LOCAL_OPERATION_FAILED','INPUT_REJECTED','ARCHIVE_CHECKSUM_MISMATCH','EVIDENCE_CHECKSUM_MISMATCH','PROOF_SHAPE_REJECTED','PROOF_PRECONDITION_REJECTED','UNSUPPORTED_DATABASE_SETTINGS','NATIVE_FAILED','NATIVE_TIMEOUT','NATIVE_PERMISSION_DENIED','NATIVE_ROLE_MISSING','NATIVE_OBJECT_EXISTS','NATIVE_UNKNOWN_SETTING','NATIVE_ARCHIVE_INVALID','SQL_PERMISSION_DENIED','SQL_OBJECT_MISSING','SQL_OBJECT_EXISTS','SQL_FEATURE_UNSUPPORTED','SQL_INTERNAL_ERROR','SQL_CONNECTION_FAILED','PROOF_DIFFERENCE','MATCH'}
SQLSTATES={'42501','42704','42P04','42P07','3D000','0A000','XX000','08006'}

def require(condition):
    if not condition:raise ValueError('DIAGNOSTIC_PRECONDITION_REJECTED')

def clean_environment():
    return {'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C','PGPASSFILE':'/dev/null','PGCONNECT_TIMEOUT':'5'}

def private_directory(directory):
    s=os.lstat(directory)
    require(stat.S_ISDIR(s.st_mode) and s.st_uid==os.getuid() and not s.st_mode&0o077)

def private_stat(filename):
    private_directory(Path(filename).parent)
    s=os.lstat(filename)
    require(stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and not s.st_mode&0o077 and s.st_nlink==1 and s.st_size<=16*1024*1024)
    return s

def checksum(filename):
    digest=hashlib.sha256()
    with open(filename,'rb') as stream:
        for data in iter(lambda:stream.read(1024*1024),b''):digest.update(data)
    return digest.hexdigest()

def safe_result(value):
    required={'status','failedStage','category','mismatchFields','cleanup'}
    require(type(value) is dict and required<=set(value)<=required|{'sqlstate','reportWrite','relationAnalysis'})
    require(value['status'] in {'LOCAL_RESTORE_MATCH','LOCAL_RESTORE_DIFFERENCE','LOCAL_RESTORE_FAILED'})
    require(value['failedStage'] is None or value['failedStage'] in STAGES)
    require(value['category'] in CATEGORIES and value['cleanup'] in {'ok','failed','unknown'})
    require(type(value['mismatchFields']) is list and len(value['mismatchFields'])<=len(FIELDS) and all(type(x) is str and x in FIELDS for x in value['mismatchFields']))
    if 'sqlstate' in value:require(value['sqlstate'] in SQLSTATES)
    if 'reportWrite' in value:require(value['reportWrite'] in {'saved','failed'})
    if 'relationAnalysis' in value:
        require(value['status']=='LOCAL_RESTORE_DIFFERENCE' and 'schema.relations' in value['mismatchFields'])
        detail=value['relationAnalysis'];require(type(detail) is dict)
        if detail.get('status')=='unavailable':require(set(detail)=={'status'})
        else:
            counts={'sourceCount','restoredCount','missingCount','addedCount','changedCount','aclDefaultEquivalentCount','aclEncodingEquivalentCount','aclPrivilegeDifferenceCount','aclUnclassifiedCount','sourceExplicitToNullCount','sourceNullToExplicitCount'}
            require(set(detail)==counts|{'status','changedFields','orderChanged'} and detail['status']=='complete')
            require(all(type(detail[key]) is int and 0<=detail[key]<=1024 for key in counts))
            fields=detail['changedFields'];require(type(fields) is list and len(fields)<=7 and all(type(field) is str and field in {'relname','relkind','owner','relacl','reloptions','relrowsecurity','relforcerowsecurity'} for field in fields) and len(set(fields))==len(fields))
            require(type(detail['orderChanged']) is bool)
            require(detail['missingCount']<=detail['sourceCount'] and detail['addedCount']<=detail['restoredCount'] and detail['changedCount']<=min(detail['sourceCount']-detail['missingCount'],detail['restoredCount']-detail['addedCount']))
            require(detail['sourceCount']-detail['missingCount']==detail['restoredCount']-detail['addedCount'])
            require(sum(detail[key] for key in ['aclDefaultEquivalentCount','aclEncodingEquivalentCount','aclPrivilegeDifferenceCount','aclUnclassifiedCount'])<=detail['changedCount'])
            require(detail['sourceExplicitToNullCount']+detail['sourceNullToExplicitCount']==detail['aclDefaultEquivalentCount'])
    return value

def verify_manifest(filename,expected):
    require(re.fullmatch('[a-f0-9]{64}',expected))
    private_stat(filename);require(checksum(filename)==expected)
    manifest=json.loads(Path(filename).read_text())
    root=Path(manifest['bundleRoot']);require(root.is_absolute() and root.resolve()==root and Path(__file__).resolve()==root/'launcher.py')
    require(manifest['formatVersion']==1 and manifest['kind']=='local-only-restore-diagnostic')
    require(manifest['python']==str(Path(sys.executable).resolve()))
    require(Path(manifest['node']).is_absolute() and Path(manifest['pgBin']).is_absolute())
    private_directory(root)
    # Exact immutable bundle inventory, excluding only this checksum-bound manifest.
    actual={str(p) for p in root.rglob('*') if p.is_file() and p!=Path(filename)}
    require(actual==set(manifest['bundleFiles']))
    for p in root.rglob('*'):
        s=p.lstat();require(not p.is_symlink() and not s.st_mode&0o222 and s.st_uid==os.getuid())
    for name,expected_hash in {**manifest['bundleFiles'],**manifest['runtimeFiles']}.items():
        require(re.fullmatch('[a-f0-9]{64}',expected_hash) and checksum(name)==expected_hash)
    config=manifest['config'];require(set(config)=={'dumpPath','evidencePath','expectedDumpSha256','expectedEvidenceSha256','workDirectory','pgBin','assetsRoot'})
    require(config['pgBin']==manifest['pgBin'] and config['assetsRoot']==str(root/'assets'))
    require(re.fullmatch('[a-f0-9]{64}',config['expectedDumpSha256']) and re.fullmatch('[a-f0-9]{64}',config['expectedEvidenceSha256']))
    for name in ['dumpPath','evidencePath']:
        require(Path(config[name]).is_absolute() and Path(config[name]).resolve()==Path(config[name]));private_stat(config[name])
    # --check deliberately never opens or hashes the actual dump.
    require(checksum(config['evidencePath'])==config['expectedEvidenceSha256'])
    require(Path(config['workDirectory']).parent==Path('/private/tmp') and re.fullmatch('mentor-restore-diagnostic-run-[a-z0-9-]+',Path(config['workDirectory']).name))
    require(not Path(config['workDirectory']).exists())
    return manifest

def sandbox_profile(manifest):
    # All external network is denied; only private Unix sockets are allowed.
    # Writes are limited to the newly-created diagnostic directory and /dev/null.
    # Deny user-home and other temporary-file reads, except pinned inputs/code.
    quote=lambda value:json.dumps(str(value))
    config=manifest['config']
    socket=Path(config['workDirectory'])/'s/.s.PGSQL.5432'
    ancestors=sorted({str(parent) for name in [manifest['node'],manifest['bundleRoot'],config['workDirectory'],config['dumpPath'],config['evidencePath']] for parent in Path(name).parents})
    return '\n'.join([
        '(version 1)','(allow default)','(deny network*)',
        f'(allow network* (local unix-socket (path-literal {quote(socket)})) (remote unix-socket (path-literal {quote(socket)})))',
        '(deny file-write*)',f'(allow file-write* (subpath {quote(config["workDirectory"])}) (literal "/dev/null"))',
        '(deny file-read* (subpath "/Users") (subpath "/private/tmp") (subpath "/private/var/folders"))',
        f'(allow file-read* (literal {quote(manifest["node"])}) (subpath {quote(manifest["bundleRoot"])}) (subpath {quote(config["workDirectory"])}) (literal {quote(config["dumpPath"])}) (literal {quote(config["evidencePath"])}))',
        f'(allow file-read-metadata (literal {quote(Path(config["dumpPath"]).parent)}) (literal {quote(Path(config["evidencePath"]).parent)}))',
        '(allow file-read-metadata '+' '.join('(literal '+quote(parent)+')' for parent in ancestors)+')',
    ])

def cleanup_local(manifest):
    """Supervisor fallback, including abnormal Node exit and user interruption."""
    config=manifest['config'];work=Path(config['workDirectory']);private_directory(work)
    cluster=work/'cluster'
    if cluster.is_symlink():return 'failed'
    if cluster.exists() and (cluster/'PG_VERSION').exists():
        args=['/usr/bin/sandbox-exec','-p',sandbox_profile(manifest),str(Path(manifest['pgBin'])/'pg_ctl'),'-D',str(cluster)]
        def control(options):
            return subprocess.run([*args,*options],cwd=work,env=clean_environment(),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30).returncode
        status=control(['status'])
        if status==0:
            if control(['-m','immediate','-w','stop'])!=0:return 'failed'
            status=control(['status'])
        if status!=3:return 'failed'  # 3 explicitly means server not running.
    elif (cluster/'postmaster.pid').exists():return 'failed'
    for name in ['cluster','s']:
        item=work/name
        if item.is_symlink():return 'failed'
        if item.exists():shutil.rmtree(item)
    (work/'server.log').unlink(missing_ok=True)
    return 'ok'

def emit_progress(work,seen):
    """Only fixed stage names from the private diagnostic journal are visible."""
    filename=Path(work)/'progress.jsonl'
    try:
        info=private_stat(filename);require(info.st_size<=4096)
        fd=os.open(filename,os.O_RDONLY|os.O_NOFOLLOW)
        try:data=os.read(fd,4096).decode('ascii')
        finally:os.close(fd)
        for line in data.splitlines():
            row=json.loads(line)
            if set(row)=={'stage'} and row['stage'] in STAGES and row['stage'] not in seen:
                seen.add(row['stage']);print('LOCAL_DIAGNOSTIC_STAGE='+row['stage'],flush=True)
    except Exception:pass  # Progress reporting never changes the restore decision.

def execute(manifest,interrupted=lambda:False):
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    config=manifest['config'];work=Path(config['workDirectory']);work.mkdir(mode=0o700)
    # The private run directory is a one-use diagnostic claim, not a refresh claim.
    args=['/usr/bin/sandbox-exec','-p',sandbox_profile(manifest),manifest['node'],str(Path(manifest['bundleRoot'])/'diagnostic.cjs')]
    child=subprocess.Popen(args,cwd=work,env=clean_environment(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)
    result={'status':'LOCAL_RESTORE_FAILED','failedStage':None,'category':'LOCAL_OPERATION_FAILED','mismatchFields':[],'cleanup':'unknown'}
    seen=set()
    try:
        payload=json.dumps(config).encode();deadline=time.monotonic()+420
        while True:
            if interrupted():raise KeyboardInterrupt
            remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError('LOCAL_DIAGNOSTIC_TIMEOUT')
            try:
                output,_=child.communicate(payload,timeout=min(0.25,remaining));break
            except subprocess.TimeoutExpired as error:
                payload=None;require(len(error.output or b'')<4096);emit_progress(work,seen)
        require(len(output)<4096)
        result=safe_result(json.loads(output))
    except (Exception,KeyboardInterrupt):
        pass
    finally:
        if child.poll() is None:
            try:os.killpg(child.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                try:os.killpg(child.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                child.wait()
        try:result['cleanup']=cleanup_local(manifest)
        except Exception:result['cleanup']='failed'
        emit_progress(work,seen)
    # Only allowlisted output is shown. Node/native stderr is never surfaced.
    print(json.dumps(safe_result(result),separators=(',',':')),flush=True)
    code=0 if not interrupted() and result['status']=='LOCAL_RESTORE_MATCH' and result['cleanup']=='ok' and result.get('reportWrite')!='failed' and child.returncode==0 else 2
    try:
        with open(work/'supervisor-result.json','x') as stream:
            os.chmod(work/'supervisor-result.json',0o600)
            json.dump({'result':result,'exitCode':code},stream);stream.write('\n');stream.flush();os.fsync(stream.fileno())
    except Exception:print('LOCAL_DIAGNOSTIC_RESULT_RECORD_FAILED',flush=True);code=2
    return code

def main():
    print('LOCAL_DIAGNOSTIC_STARTED',flush=True);code=2
    stopped=False
    def stop(signum,frame):
        # Do not raise inside process creation or cleanup. The bounded loop
        # observes this flag and always completes the supervisor's finally.
        nonlocal stopped
        stopped=True
    previous={number:signal.signal(number,stop) for number in [signal.SIGINT,signal.SIGTERM,signal.SIGHUP]}
    try:
        class SafeParser(argparse.ArgumentParser):
            def error(self,message):raise ValueError('ARGUMENTS_REJECTED')
        parser=SafeParser(description=__doc__)
        parser.add_argument('--manifest',required=True);parser.add_argument('--manifest-sha256',required=True);parser.add_argument('--check',action='store_true')
        args=parser.parse_args()
        print('LOCAL_DIAGNOSTIC_VALIDATING',flush=True)
        manifest=verify_manifest(args.manifest,args.manifest_sha256)
        require(not stopped)
        if args.check:print('LOCAL_DIAGNOSTIC_READY_NO_DUMP_READ_NO_REMOTE_ACCESS',flush=True);code=0
        else:
            print('LOCAL_DIAGNOSTIC_RESTORING_LOCAL_COPY',flush=True);code=execute(manifest,lambda:stopped)
    except (Exception,KeyboardInterrupt):
        print('LOCAL_DIAGNOSTIC_STOPPED_NO_REMOTE_ACCESS',flush=True)
    except SystemExit as error:code=error.code if isinstance(error.code,int) and 0<=error.code<=255 else 2
    finally:
        if stopped:code=2;print('LOCAL_DIAGNOSTIC_INTERRUPTED',flush=True)
        print('LOCAL_DIAGNOSTIC_EXIT='+str(code),flush=True)
        for number,handler in previous.items():signal.signal(number,handler)
    return code

if __name__=='__main__':sys.exit(main())
