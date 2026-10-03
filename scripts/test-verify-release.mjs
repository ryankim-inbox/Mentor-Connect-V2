import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const originalBaseline = "98e1b04c292302bd25365ed7db4c5675671df337";
const pullRequestBase = "5fb771b43832f7fdf75199c52d534a396f72e912";

const output = execFileSync("sh", ["scripts/verify-release.sh", "--print"], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...process.env,
    PYTHON_FREEZE_BASE: originalBaseline,
    PYTHON_PR_BASE: pullRequestBase,
    PYTHON_FREEZE_SCOPE_REF: "test-release-track",
    GITHUB_HEAD_REF: "test-release-track",
  },
});

assert.deepEqual(output.trim().split("\n"), [
  "pnpm install --frozen-lockfile",
  "node scripts/test-python-runtime.mjs",
  "node scripts/test-python-freeze.mjs",
  "sh scripts/test-python.sh",
  "pnpm typecheck",
  "pnpm build:release",
  "pnpm test:gateway",
  "pnpm --filter @workspace/mockup-sandbox test",
  "pnpm test:migrations",
  "pnpm --filter @workspace/db test",
  "pnpm --filter @workspace/peerbridge test:unit",
  "pnpm api:generate",
  "git diff --exit-code -- lib/api-client-react/src/generated lib/api-zod/src/generated",
  "pnpm api:contract-test",
  "node scripts/verify-api-boundary.mjs",
  "sh scripts/check-secrets.sh",
  "pnpm test:secrets",
  "node --test scripts/smoke-classroom.test.mjs",
  "pnpm exec playwright install --with-deps chromium",
  "pnpm e2e",
  `node scripts/check-python-unchanged.mjs ${originalBaseline}`,
  `node scripts/check-python-unchanged.mjs ${pullRequestBase}`,
]);

const futureStudentPlan = execFileSync(
  "sh",
  ["scripts/verify-release.sh", "--print"],
  {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHON_FREEZE_BASE: originalBaseline,
      PYTHON_PR_BASE: pullRequestBase,
      PYTHON_FREEZE_SCOPE_REF: "future-student-python-work",
      GITHUB_HEAD_REF: "unrelated-student-track",
    },
  },
);
assert.doesNotMatch(futureStudentPlan, /check-python-unchanged/);
assert.match(futureStudentPlan, /pnpm e2e/);

const fakeBin = mkdtempSync(path.join(tmpdir(), "verify-release-bin-"));
try {
  writeFileSync(
    path.join(fakeBin, "pnpm"),
    "#!/bin/sh\necho fake-pnpm-called >&2\nexit 42\n",
    { mode: 0o755 },
  );
  const normalRun = spawnSync("sh", ["scripts/verify-release.sh"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      PYTHON_FREEZE_BASE: originalBaseline,
      PYTHON_PR_BASE: pullRequestBase,
      PYTHON_FREEZE_SCOPE_REF: "test-release-track",
      GITHUB_HEAD_REF: "test-release-track",
    },
  });
  assert.equal(normalRun.status, 42);
  assert.match(normalRun.stderr, /fake-pnpm-called/);
} finally {
  rmSync(fakeBin, { recursive: true, force: true });
}

const gateBin = mkdtempSync(path.join(tmpdir(), "verify-release-backend-"));
try {
  for (const command of ["pnpm", "node", "sh"]) {
    writeFileSync(
      path.join(gateBin, command),
      `#!/bin/sh
echo '${command}' "$@" "PYTHON_BIN=$PYTHON_BIN" "CLASSROOM_TEST_PYTHON=$CLASSROOM_TEST_PYTHON"
if [ '${command}' = sh ] && [ "$1" = scripts/test-python.sh ]; then
  exit "\${BACKEND_EXIT:-0}"
fi
`,
      { mode: 0o755 },
    );
  }
  for (const pythonBin of [undefined, path.join(gateBin, "custom-python")]) {
    const expectedPython = pythonBin ?? path.join(root, ".venv/bin/python");
    const env = {
      ...process.env,
      PATH: `${gateBin}:${process.env.PATH}`,
      GITHUB_HEAD_REF: "release-backend-test",
      CLASSROOM_TEST_PYTHON: "/incorrect/interpreter",
    };
    if (pythonBin) env.PYTHON_BIN = pythonBin;
    else delete env.PYTHON_BIN;
    const success = spawnSync("/bin/sh", ["scripts/verify-release.sh"], {
      cwd: root, encoding: "utf8", env,
    });
    assert.equal(success.status, 0, success.stderr);
    const interpreters = `PYTHON_BIN=${expectedPython} CLASSROOM_TEST_PYTHON=${expectedPython}`;
    assert.ok(success.stdout.includes(`sh scripts/test-python.sh ${interpreters}`));
    assert.ok(success.stdout.includes(`pnpm --filter @workspace/db test ${interpreters}`));

    const failure = spawnSync("/bin/sh", ["scripts/verify-release.sh"], {
      cwd: root, encoding: "utf8", env: { ...env, BACKEND_EXIT: "43" },
    });
    assert.equal(failure.status, 43, failure.stderr);
    assert.deepEqual(failure.stdout.trim().split("\n"), [
      `pnpm install --frozen-lockfile ${interpreters}`,
      `node scripts/test-python-runtime.mjs ${interpreters}`,
      `node scripts/test-python-freeze.mjs ${interpreters}`,
      `sh scripts/test-python.sh ${interpreters}`,
    ]);
  }
} finally {
  rmSync(gateBin, { recursive: true, force: true });
}

const releaseWorkflow = readFileSync(
  path.join(root, ".github/workflows/release-surface.yml"),
  "utf8",
);
for (const required of [
  "name: Production release surface",
  "name: peerbridge-release-surface",
  "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  "node-version-file: .node-version",
  "PYTHON_PR_BASE: ${{ github.event.pull_request.base.sha }}",
  "postgresql-16",
  "/usr/lib/postgresql/16/bin",
  "run: pnpm verify:release",
  "pnpm audit --prod --audit-level high --json",
  "pnpm audit --audit-level high --json",
]) {
  assert.ok(releaseWorkflow.includes(required), `release workflow is missing ${required}`);
}
assert.doesNotMatch(releaseWorkflow, /^\s+services:/m);
assert.doesNotMatch(releaseWorkflow, /DATABASE_URL|SESSION_SECRET|secrets\./);

// Run the real provisioning block with stand-ins for network-bound tooling.
const provisioning = [...releaseWorkflow.matchAll(/        run: \|\n((?:          .*\n)+)/g)]
  .map((match) => match[1].replace(/^          /gm, ""))
  .find((script) => script.includes("uv sync"));
assert.ok(provisioning, "release workflow must provision the locked Python dev environment");
const runnerTemp = mkdtempSync(path.join(tmpdir(), "verify-release-python-ci-"));
try {
  const bin = path.join(runnerTemp, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "python3"), `#!/bin/sh
set -eu
case "$*" in
  "-m venv $RUNNER_TEMP/mentor-uv-tools")
    mkdir -p "$RUNNER_TEMP/mentor-uv-tools/bin"
    cp "$0" "$RUNNER_TEMP/mentor-uv-tools/bin/python"
    ;;
  "-m pip install uv==0.11.16")
    cp "$FAKE_UV" "$RUNNER_TEMP/mentor-uv-tools/bin/uv"
    ;;
  *) echo "unexpected Python provisioning: $*" >&2; exit 44 ;;
esac
`, { mode: 0o755 });
  writeFileSync(path.join(bin, "uv"), "#!/bin/sh\necho 'isolated uv tools environment was not activated' >&2\nexit 45\n", { mode: 0o755 });
  const fakeUv = path.join(runnerTemp, "uv-stub");
  writeFileSync(fakeUv, `#!/bin/sh
set -eu
test "$*" = 'sync --frozen --python 3.12 --group dev'
test "$UV_PROJECT_ENVIRONMENT" = "$RUNNER_TEMP/mentor-python"
mkdir -p "$UV_PROJECT_ENVIRONMENT/bin"
touch "$UV_PROJECT_ENVIRONMENT/bin/python"
`, { mode: 0o755 });
  const githubPath = path.join(runnerTemp, "github-path");
  const githubEnv = path.join(runnerTemp, "github-env");
  const result = spawnSync("/bin/sh", ["-eu", "-c", provisioning], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_UV: fakeUv,
      RUNNER_TEMP: runnerTemp,
      GITHUB_PATH: githubPath,
      GITHUB_ENV: githubEnv,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(githubPath, "utf8").trim(), path.join(runnerTemp, "mentor-uv-tools/bin"));
  assert.deepEqual(readFileSync(githubEnv, "utf8").trim().split("\n"), [
    `PYTHON_BIN=${runnerTemp}/mentor-python/bin/python`,
    `CLASSROOM_TEST_PYTHON=${runnerTemp}/mentor-python/bin/python`,
  ]);
} finally {
  rmSync(runnerTemp, { recursive: true, force: true });
}

const secretWorkflow = readFileSync(
  path.join(root, ".github/workflows/secret-scan.yml"),
  "utf8",
);
assert.match(secretWorkflow, /node scripts\/test-verify-release\.mjs/);

const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
assert.equal(packageJson.scripts["verify:release"], "sh scripts/verify-release.sh");

console.log("release verification plan passed");
