#!/usr/bin/env python3
"""Build a pinned local diagnostic bundle without opening the dump or connecting."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import sys

def sha(filename):
    digest=hashlib.sha256()
    with open(filename,'rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()

def execution_command(python,launcher,launcher_sha,manifest,manifest_sha,check=False):
    # Hash the exact bytes before executing them. env -i runs before Python,
    # preventing inherited loader/credential variables from reaching startup.
    script="import hashlib,pathlib,sys;p=pathlib.Path("+repr(str(launcher))+");b=p.read_bytes();"
    script+="\nif hashlib.sha256(b).hexdigest()!="+repr(launcher_sha)+":raise SystemExit('DIAGNOSTIC_LAUNCHER_HASH_MISMATCH')"
    script+="\nsys.argv="+repr([str(launcher),'--manifest',str(manifest),'--manifest-sha256',manifest_sha]+(['--check'] if check else []))
    script+=";exec(compile(b,str(p),'exec'),{'__name__':'__main__','__file__':str(p)})"
    return shlex.join(['/usr/bin/env','-i',str(python),'-I','-B','-c',script])

def write_wrapper(filename,python,launcher,launcher_sha,manifest,manifest_sha):
    """A short, inspectable entry point. The launcher is hash-checked internally."""
    args=[str(launcher),'--manifest',str(manifest),'--manifest-sha256',manifest_sha]
    bootstrap='''import hashlib,pathlib,sys
code=2
try:
    extra=sys.argv[1:]
    if extra not in ([],["--check"]):raise ValueError("ARGUMENTS_REJECTED")
    p=pathlib.Path(LAUNCHER_PATH);body=p.read_bytes()
    if hashlib.sha256(body).hexdigest()!=LAUNCHER_SHA:
        print("LOCAL_DIAGNOSTIC_LAUNCHER_HASH_MISMATCH",flush=True)
    else:
        sys.argv=LAUNCHER_ARGS+extra
        namespace={"__name__":"mentor_restore_diagnostic_bootstrap","__file__":str(p)}
        exec(compile(body,str(p),"exec"),namespace)
        code=namespace["main"]()
        if not isinstance(code,int) or not 0<=code<=255:code=2
except (Exception,KeyboardInterrupt):
    print("LOCAL_DIAGNOSTIC_BOOTSTRAP_FAILED",flush=True)
except SystemExit as error:
    code=error.code if isinstance(error.code,int) and 0<=error.code<=255 else 2
sys.exit(code)
'''.replace('LAUNCHER_PATH',repr(str(launcher))).replace('LAUNCHER_SHA',repr(launcher_sha)).replace('LAUNCHER_ARGS',repr(args))
    script='''#!/bin/sh
printf '%s\\n' 'LOCAL_DIAGNOSTIC_WRAPPER_STARTED'
trap 'diagnostic_exit=$?; trap - 0; printf "LOCAL_DIAGNOSTIC_WRAPPER_EXIT=%s\\n" "$diagnostic_exit"; exit "$diagnostic_exit"' 0
diagnostic_child=
diagnostic_stop() {
    diagnostic_signal_exit=$1
    trap '' INT TERM HUP
    diagnostic_child=${diagnostic_child:-$!}
    if [ -n "$diagnostic_child" ]; then
        kill -TERM "$diagnostic_child" 2>/dev/null || :
        wait "$diagnostic_child" 2>/dev/null || :
    fi
    exit "$diagnostic_signal_exit"
}
trap 'diagnostic_stop 130' INT
trap 'diagnostic_stop 143' TERM
trap 'diagnostic_stop 129' HUP
'''+shlex.join(['/usr/bin/env','-i',str(python),'-I','-B','-'])+''' "$@" <<'MC_LOCAL_RESTORE_BOOTSTRAP' &
'''+bootstrap+'''MC_LOCAL_RESTORE_BOOTSTRAP
diagnostic_child=$!
wait "$diagnostic_child"
diagnostic_exit=$?
exit "$diagnostic_exit"
'''
    with open(filename,'x') as stream:
        os.chmod(filename,0o500);stream.write(script);stream.flush();os.fsync(stream.fileno())
    return str(filename)

def build(args):
    root=Path(__file__).resolve().parents[2]
    bundle=Path(args.bundle).resolve();bundle.mkdir(mode=0o700)
    node=Path(args.node).resolve();pg_bin=Path(args.pg_bin).resolve()
    env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'}
    assert subprocess.run([str(node),'--version'],env=env,check=True,capture_output=True).stdout.strip()==b'v24.21.0'
    assert b'PostgreSQL) 18.6' in subprocess.run([str(pg_bin/'postgres'),'--version'],env=env,check=True,capture_output=True).stdout
    esbuild=root/'node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/lib/main.js'
    script="const esbuild=require(process.argv[1]);const fs=require('node:fs');const r=esbuild.buildSync({entryPoints:[process.argv[2]],outfile:process.argv[3],bundle:true,platform:'node',format:'cjs',target:'node24',external:['pg-native'],metafile:true,logLevel:'silent'});fs.writeFileSync(process.argv[4],JSON.stringify(r.metafile));"
    subprocess.run([str(node),'-e',script,str(esbuild),str(root/'ops/restore-diagnostic/entry.mjs'),str(bundle/'diagnostic.cjs'),str(bundle/'metafile.json')],env=env,cwd=root,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    inputs=json.loads((bundle/'metafile.json').read_text())['inputs']
    allowed={'ops/restore-diagnostic/entry.mjs','ops/restore-diagnostic/diagnostic.mjs','ops/restore-diagnostic/proof.mjs','ops/restore-relation-acls.mjs','ops/synthetic-revision-evidence.mjs','lib/db/tools/schema-assets.mjs','lib/db/tools/migration-ledger.mjs','lib/db/tools/catalog.mjs'}
    assert all(name.startswith('node_modules/.pnpm/') or name in allowed for name in inputs)
    (bundle/'source-hashes.json').write_text(json.dumps({name:sha(root/name) for name in inputs},sort_keys=True))
    shutil.copyfile(root/'ops/restore-diagnostic/launcher.py',bundle/'launcher.py')
    for directory in ['schema','migrations']:shutil.copytree(root/'database'/directory,bundle/'assets/database'/directory)
    evidence=Path(args.evidence).resolve();dump=Path(args.dump).resolve()
    # Metadata only. The existing dump checksum is recorded by the prior backup.
    metadata=json.loads(evidence.read_text());assert metadata['schemaVersion']=='0008'
    config={'dumpPath':str(dump),'evidencePath':str(evidence),'expectedDumpSha256':metadata['sha256'],'expectedEvidenceSha256':sha(evidence),'workDirectory':str(Path(args.output).resolve()),'pgBin':str(pg_bin),'assetsRoot':str(bundle/'assets')}
    runtimes=[str(node),str(Path(sys.executable).resolve()),'/usr/bin/sandbox-exec',*[str(pg_bin/tool) for tool in ['initdb','pg_ctl','pg_restore','postgres']]]
    manifest={'formatVersion':1,'kind':'local-only-restore-diagnostic','bundleRoot':str(bundle),'python':str(Path(sys.executable).resolve()),'node':str(node),'pgBin':str(pg_bin),'bundleFiles':{str(p):sha(p) for p in sorted(bundle.rglob('*')) if p.is_file()},'runtimeFiles':{p:sha(p) for p in runtimes},'config':config}
    manifest_path=bundle/'manifest.json';manifest_path.write_text(json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n')
    for p in bundle.rglob('*'):p.chmod(0o500 if p.is_dir() else 0o400)
    bundle.chmod(0o500)
    wrapper=Path(args.wrapper).resolve() if args.wrapper else bundle.with_suffix('.command')
    write_wrapper(wrapper,Path(sys.executable).resolve(),bundle/'launcher.py',sha(bundle/'launcher.py'),manifest_path,sha(manifest_path))
    return {'bundle':str(bundle),'manifest':str(manifest_path),'manifestSha256':sha(manifest_path),'launcherSha256':sha(bundle/'launcher.py'),'wrapper':str(wrapper),'wrapperSha256':sha(wrapper),'dumpRead':False,'remoteAccess':False}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['bundle','output','dump','evidence']:p.add_argument('--'+name,required=True)
    p.add_argument('--wrapper')
    p.add_argument('--node',default='/Users/rinny/.nvm/versions/node/v24.21.0/bin/node');p.add_argument('--pg-bin',default='/opt/homebrew/opt/postgresql@18/bin')
    try:print(json.dumps(build(p.parse_args())));return 0
    except Exception:print('DIAGNOSTIC_BUNDLE_BUILD_REJECTED');return 1

if __name__=='__main__':sys.exit(main())
