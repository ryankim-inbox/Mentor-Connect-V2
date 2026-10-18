#!/usr/bin/env python3
"""User-run bootstrap. A reviewed frozen manifest/hash is required; none is bundled.

Run using a trusted Python with -I -B. Only the user enters the password at a TTY.
No terminal is opened and no credential source is read by this module.
"""
import sys
if __name__ == "__main__" and (not sys.flags.isolated or not sys.dont_write_bytecode):
    sys.stderr.write("ISOLATED_PYTHON_REQUIRED\n")
    raise SystemExit(1)

import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import secrets
import stat
import subprocess
import warnings

APPROVAL = "Sentinel_ffd3ea6a2ec481918348d4055e1c5da7"
RECEIPT_SHA256 = "3dcd43fc601fa0a0556ce80ce6407ca0a6e0358d41623c0b9f864fb88c9b5e08"
TARGET = {"project":"purple-pond-78194407","branch":"br-super-queen-b5j58k39","host":"ep-crimson-night-b552ar17.c-7.us-east-2.aws.neon.tech","port":5432,"database":"neondb","user":"neondb_owner","renderService":"srv-db96aglg1s2s739tbtd0"}
STATUSES = frozenset({"WAITING_FOR_FRESH_WRITER_EVIDENCE", "BACKUP_RESTORE_VERIFIED", "REVISION_COMMITTED", "STOPPED_BEFORE_REVISION", "REVISION_NOT_COMMITTED_RECHECK_SOURCE", "REVISION_COMMIT_UNCONFIRMED", "REVISION_COMMITTED_FOLLOWUP_NOT_CONFIRMED"})


def require(condition):
    if not condition:
        raise ValueError("HANDOFF_PRECONDITION_REJECTED")


def clean_environment():
    # No HOME, PG*, NODE_OPTIONS, PYTHON*, SSL*, DYLD*, cloud credentials or hooks.
    return {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"}


def private_directory(directory):
    entry = os.lstat(directory)
    require(stat.S_ISDIR(entry.st_mode) and entry.st_uid == os.getuid() and entry.st_mode & 0o077 == 0)


def private_read(filename):
    private_directory(Path(filename).parent)
    fd = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        entry = os.fstat(fd)
        require(stat.S_ISREG(entry.st_mode) and entry.st_uid == os.getuid() and entry.st_mode & 0o077 == 0 and entry.st_nlink == 1 and entry.st_size < 16 * 1024 * 1024)
        with os.fdopen(fd, "rb", closefd=False) as stream:
            return stream.read()
    finally:
        os.close(fd)


def file_hash(filename):
    result = hashlib.sha256()
    with open(filename, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def inventory(scopes):
    files, links = set(), {}
    for scope in scopes:
        require(Path(scope).is_dir() and not Path(scope).is_symlink())
        root_stat = os.lstat(scope)
        require(root_stat.st_uid == os.getuid() and root_stat.st_mode & 0o222 == 0)
        for base, dirs, names in os.walk(scope, followlinks=False):
            for name in [*dirs, *names]:
                item = Path(base) / name
                info = os.lstat(item)
                require(info.st_uid == os.getuid())
                if stat.S_ISLNK(info.st_mode):
                    links[str(item)] = str(item.resolve(strict=True))
                elif stat.S_ISREG(info.st_mode):
                    require(info.st_mode & 0o222 == 0)
                    files.add(str(item))
                else:
                    require(stat.S_ISDIR(info.st_mode) and info.st_mode & 0o222 == 0)
    return files, links


def verify_manifest(filename, expected_sha256):
    require(re.fullmatch(r"[a-f0-9]{64}", expected_sha256))
    raw = private_read(filename)
    require(hashlib.sha256(raw).hexdigest() == expected_sha256)
    manifest = json.loads(raw)
    require(manifest["formatVersion"] == 1 and re.fullmatch(r"[a-f0-9]{40}", manifest["releaseSha"]))
    require(manifest["approval"] == APPROVAL and manifest["target"] == TARGET and manifest["receiptSha256"] == RECEIPT_SHA256)
    root = Path(manifest["codeRoot"])
    require(root.is_absolute() and root.resolve() == root)
    require(Path(__file__).resolve() == root / "ops/demo-refresh-handoff/launcher.py")
    require(manifest["scopes"] == [str(root / x) for x in ("ops", "lib/db", "database", "node_modules")])
    files, links = inventory(manifest["scopes"])
    require(links == manifest["links"])
    require(all(target.startswith(str(root) + os.sep) for target in links.values()))
    required_external = {manifest["node"], *[str(Path(manifest["pgBin"]) / tool) for tool in ("initdb", "pg_ctl", "pg_dump", "pg_restore", "postgres")], "/private/etc/ssl/cert.pem", str(Path(sys.executable).resolve())}
    require(set(manifest["files"]) == files | required_external)
    for name, expected in manifest["files"].items():
        require(Path(name).is_absolute() and re.fullmatch(r"[a-f0-9]{64}", expected) and file_hash(name) == expected)
    require(file_hash(manifest["receiptPath"]) == RECEIPT_SHA256)
    private_directory(manifest["directory"])
    # Output/attempt files must never live inside the clean source snapshot.
    require(not str(Path(manifest["directory"]).resolve()).startswith(str(root) + os.sep))
    for args, expected in [(["rev-parse", "HEAD"], manifest["releaseSha"] + "\n"), (["status", "--porcelain", "--untracked-files=all"], "")]:
        result = subprocess.run(["/usr/bin/git", *args], cwd=root, env=clean_environment(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=30)
        require(result.stdout.decode() == expected)
    manifest["manifestSha256"] = expected_sha256
    return manifest


def claim_attempt(manifest):
    private_directory(manifest["directory"])
    token = secrets.token_hex(32)
    claim = {"formatVersion":1,"state":"claimed-no-retry","attemptId":secrets.token_hex(16),"releaseSha":manifest["releaseSha"],"manifestSha256":manifest["manifestSha256"],"revisionId":manifest["revisionId"],"claimTokenDigest":hashlib.sha256(token.encode()).hexdigest(),"target":TARGET,"approval":APPROVAL}
    fd = os.open(Path(manifest["directory"]) / "attempt.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        data = (json.dumps(claim, sort_keys=True) + "\n").encode()
        while data:
            data = data[os.write(fd, data):]
        os.fsync(fd)
    finally:
        os.close(fd)
    directory_fd = os.open(manifest["directory"], os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    return token


def execute(manifest_path, expected_sha256, *, tty_check=None, prompt=None, runner=None):
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    manifest = verify_manifest(manifest_path, expected_sha256)
    require((tty_check or (lambda: sys.stdin.isatty() and sys.stdout.isatty()))())
    args = [manifest["node"], str(Path(manifest["codeRoot"]) / "ops/demo-refresh-handoff/driver.mjs"), "--preflight", manifest_path, expected_sha256]
    result = subprocess.run(args, env=clean_environment(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
    require(result.returncode == 0)
    token = claim_attempt(manifest)  # Durable no-retry claim precedes ALL credential reads.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        password = (prompt or getpass.getpass)("Database password (hidden): ")
    require(isinstance(password, str) and 0 < len(password) < 4096 and "\x00" not in password)
    verify_manifest(manifest_path, expected_sha256)
    if runner:
        return runner(manifest, token, password)
    args[2] = "--execute"
    process = subprocess.Popen(args, env=clean_environment(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        payload = json.dumps({"claimToken":token,"password":password}).encode()
        process.stdin.write(payload)
        process.stdin.close()
        payload = password = token = None
        for line in process.stdout:
            value = line.decode("ascii", errors="ignore").strip()
            if value in STATUSES:
                print(value, flush=True)
        return process.wait()
    finally:
        # A lost connection/process/COMMIT acknowledgement never clears the claim.
        if process.poll() is None:
            process.terminate()


def main():
    parser = argparse.ArgumentParser(description="User-only frozen revision handoff")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        if args.check:
            verify_manifest(args.manifest, args.manifest_sha256)
            print("FROZEN_FILES_VERIFIED_NO_REMOTE_ACCESS")
            return 0
        return execute(args.manifest, args.manifest_sha256)
    except (Exception, KeyboardInterrupt):
        print("HANDOFF_STOPPED_NO_AUTOMATIC_RETRY", flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
