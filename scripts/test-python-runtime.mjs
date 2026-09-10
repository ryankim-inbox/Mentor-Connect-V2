import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function fakeTools(directory, uvVersion = "0.11.16") {
  const bin = path.join(directory, "bin");
  const python = path.join(directory, "fake-python");
  await mkdir(bin);
  await writeFile(
    python,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "Python 3.12.13"
fi
`,
    { mode: 0o755 },
  );
  await writeFile(
    path.join(bin, "uv"),
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "uv ${uvVersion}"; exit 0; fi
if [ "$1 $2" = "pip compile" ]; then exit 93; fi
if [ "$1" = "venv" ]; then
  for target do :; done
  mkdir -p "$target/bin"
  cp "$FAKE_PYTHON" "$target/bin/python"
  exit 0
fi
if [ "$1 $2" = "pip sync" ]; then
  if [ -n "\${RACE_RECORD_PATH:-}" ]; then
    ln -s "$RACE_RECORD_TARGET" "$RACE_RECORD_PATH"
  fi
  exit 0
fi
exit 94
`,
    { mode: 0o755 },
  );
  return { bin, python };
}

function run(runtime, tools, extraEnv = {}) {
  return spawnSync("sh", ["ops/build-python-runtime.sh"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      FAKE_PYTHON: tools.python,
      PATH: `${tools.bin}:${process.env.PATH}`,
      RELEASE_RUNTIME_DIR: runtime,
      ...extraEnv,
    },
  });
}

test("rejects a longer uv version with the pinned prefix", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "python-runtime-uv-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const tools = await fakeTools(temporary, "0.11.160");

  const result = run(path.join(temporary, "runtime"), tools);

  assert.equal(result.status, 2, result.stderr);
});

test("rejects a dangling venv symlink", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "python-runtime-venv-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const tools = await fakeTools(temporary);
  const runtime = path.join(temporary, "runtime");
  await mkdir(runtime);
  await symlink(path.join(temporary, "missing-venv"), path.join(runtime, "venv"));

  const result = run(runtime, tools);

  assert.equal(result.status, 2, result.stderr);
});

test("rejects a dangling build record symlink without following it", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "python-runtime-record-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const tools = await fakeTools(temporary);
  const runtime = path.join(temporary, "runtime");
  const target = path.join(temporary, "outside-record");
  await mkdir(runtime);
  const lock = "frozen-lock-content\n";
  const digest = createHash("sha256").update(lock).digest("hex");
  await writeFile(path.join(runtime, "requirements.lock"), lock);
  await writeFile(path.join(runtime, "runtime.sha256"), `${digest}\n`);
  await symlink(target, path.join(runtime, "build-record.txt"));

  const result = run(runtime, tools);

  assert.equal(result.status, 2, result.stderr);
  await assert.rejects(readFile(target), { code: "ENOENT" });
});

test("atomically replaces a build record symlink introduced during the build", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "python-runtime-record-race-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const tools = await fakeTools(temporary);
  const runtime = path.join(temporary, "runtime");
  const record = path.join(runtime, "build-record.txt");
  const target = path.join(temporary, "outside-record");
  await mkdir(runtime);
  const lock = "frozen-lock-content\n";
  const digest = createHash("sha256").update(lock).digest("hex");
  await writeFile(path.join(runtime, "requirements.lock"), lock);
  await writeFile(path.join(runtime, "runtime.sha256"), `${digest}\n`);

  const result = run(runtime, tools, {
    RACE_RECORD_PATH: record,
    RACE_RECORD_TARGET: target,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal((await lstat(record)).isFile(), true);
  await assert.rejects(readFile(target), { code: "ENOENT" });
});

test("rejects a symlink that resolves to the frozen Python source", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "python-runtime-path-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const tools = await fakeTools(temporary);
  const linkedPython = path.join(temporary, "linked-python");
  await symlink(path.join(repositoryRoot, "Python"), linkedPython);

  const result = run(linkedPython, tools);

  assert.equal(result.status, 2, result.stderr);
});

test("rejects traversal through a missing directory into Python source", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "python-runtime-traversal-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const tools = await fakeTools(temporary);
  const traversedPython = `${temporary}/missing/../../..${repositoryRoot}/Python`;

  const result = run(traversedPython, tools);

  assert.equal(result.status, 2, result.stderr);
});

test("reuses an existing verified requirements lock", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "python-runtime-lock-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const tools = await fakeTools(temporary);
  const runtime = path.join(temporary, "runtime");
  await mkdir(runtime);
  const lock = "frozen-lock-content\n";
  const digest = createHash("sha256").update(lock).digest("hex");
  await writeFile(path.join(runtime, "requirements.lock"), lock);
  await writeFile(path.join(runtime, "runtime.sha256"), `${digest}\n`);

  const result = run(runtime, tools);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path.join(runtime, "requirements.lock"), "utf8"), lock);
});

test("rejects an existing lock whose recorded SHA does not match", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "python-runtime-sha-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const tools = await fakeTools(temporary);
  const runtime = path.join(temporary, "runtime");
  await mkdir(runtime);
  await writeFile(path.join(runtime, "requirements.lock"), "changed-lock\n");
  await writeFile(path.join(runtime, "runtime.sha256"), `${"0".repeat(64)}\n`);

  const result = run(runtime, tools);

  assert.notEqual(result.status, 0);
});
