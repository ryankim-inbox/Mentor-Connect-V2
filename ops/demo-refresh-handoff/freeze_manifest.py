#!/usr/bin/env python3
"""Code-only freeze builder. Run only in a new reviewed clean checkout.

Does not connect to a database, inspect credentials, create a deployment gate,
claim an attempt, or print an execution-ready command.
"""
import sys
if __name__ == "__main__" and (not sys.flags.isolated or not sys.dont_write_bytecode):
    raise SystemExit("ISOLATED_PYTHON_REQUIRED")

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

spec = importlib.util.spec_from_file_location("launcher", Path(__file__).with_name("launcher.py"))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


def freeze(args):
    root = Path(__file__).resolve().parents[2]
    require = launcher.require
    require(re.fullmatch(r"[a-f0-9]{40}", args.release))
    for command, expected in [(["rev-parse", "HEAD"], args.release + "\n"), (["status", "--porcelain", "--untracked-files=all"], "")]:
        result = subprocess.run(["/usr/bin/git", *command], cwd=root, env=launcher.clean_environment(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True)
        require(result.stdout.decode() == expected)
    require(launcher.file_hash(args.receipt) == launcher.RECEIPT_SHA256)
    node = str(Path(args.node).absolute())
    pg_bin = str(Path(args.pg_bin).absolute())
    node_version = subprocess.run([node, "--version"], env=launcher.clean_environment(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True).stdout.decode().strip()
    pg_version = subprocess.run([str(Path(pg_bin)/"postgres"), "--version"], env=launcher.clean_environment(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True).stdout.decode().strip()
    require(node_version.startswith("v24.") and re.search(r"PostgreSQL\) 18\.6(?:\s|$)", pg_version))
    # Read the reviewed identifier through the pinned Node source with no secrets.
    revision = subprocess.run([node, "--input-type=module", "-e", "const {REVISION_ID}=await import('./ops/demo-refresh-plan.mjs');process.stdout.write(REVISION_ID)"], cwd=root, env=launcher.clean_environment(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True).stdout.decode()
    require(re.fullmatch(r"[A-Za-z0-9:_-]{8,160}", revision))
    directory = Path(args.directory).resolve()
    require(not str(directory).startswith(str(root) + os.sep))
    directory.mkdir(mode=0o700)
    scopes = [str(root/name) for name in ("ops", "lib/db", "database", "node_modules")]
    for scope in scopes:
        require(Path(scope).is_dir() and not Path(scope).is_symlink())
        for base, dirs, names in os.walk(scope, followlinks=False, topdown=False):
            for name in names:
                item = Path(base)/name
                if not item.is_symlink():
                    # Preserve executable bits; remove every write permission.
                    os.chmod(item, item.stat().st_mode & ~0o222)
            for name in dirs:
                item = Path(base)/name
                if not item.is_symlink():
                    os.chmod(item, item.stat().st_mode & ~0o222)
            os.chmod(base, os.stat(base).st_mode & ~0o222)
    files, links = launcher.inventory(scopes)
    require(all(target.startswith(str(root) + os.sep) for target in links.values()))
    files.update({node, *[str(Path(pg_bin)/tool) for tool in ("initdb","pg_ctl","pg_dump","pg_restore","postgres")], "/private/etc/ssl/cert.pem", str(Path(sys.executable).resolve())})
    manifest = {"formatVersion":1,"releaseSha":args.release,"revisionId":revision,"approval":launcher.APPROVAL,"target":launcher.TARGET,"codeRoot":str(root),"directory":str(directory),"node":node,"python":str(Path(sys.executable).resolve()),"pgBin":pg_bin,"nodeVersion":node_version,"postgresVersion":pg_version,"receiptPath":str(Path(args.receipt).resolve()),"receiptSha256":launcher.RECEIPT_SHA256,"scopes":scopes,"links":links,"files":{name:launcher.file_hash(name) for name in sorted(files)}}
    manifest_path = directory/"frozen-manifest.json"
    with open(manifest_path,"x",encoding="utf-8") as stream:
        os.chmod(manifest_path,0o600)
        json.dump(manifest,stream,sort_keys=True,separators=(",",":"))
        stream.write("\n");stream.flush();os.fsync(stream.fileno())
    fd=os.open(directory,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
    checksum=launcher.file_hash(manifest_path)
    launcher.verify_manifest(str(manifest_path),checksum)
    return {"status":"FROZEN_AWAITING_DEPLOYMENT_GATE","manifest":str(manifest_path),"manifestSha256":checksum,"launcherSha256":launcher.file_hash(Path(__file__).with_name("launcher.py")),"releaseSha":args.release,"runtimeFileCount":len(files),"remoteAccess":False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release",required=True)
    parser.add_argument("--directory",required=True)
    parser.add_argument("--receipt",required=True)
    parser.add_argument("--node",default="/Users/rinny/.nvm/versions/node/v24.21.0/bin/node")
    parser.add_argument("--pg-bin",default="/opt/homebrew/opt/postgresql@18/bin")
    args=parser.parse_args()
    try:print(json.dumps(freeze(args)));return 0
    except Exception:print("FREEZE_REJECTED_NO_REMOTE_ACCESS");return 1


if __name__=="__main__":
    sys.exit(main())
