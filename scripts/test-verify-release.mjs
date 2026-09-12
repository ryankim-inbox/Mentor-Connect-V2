import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  "pnpm typecheck",
  "pnpm build:release",
  "pnpm test:gateway",
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

const secretWorkflow = readFileSync(
  path.join(root, ".github/workflows/secret-scan.yml"),
  "utf8",
);
assert.match(secretWorkflow, /node scripts\/test-verify-release\.mjs/);

const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
assert.equal(packageJson.scripts["verify:release"], "sh scripts/verify-release.sh");

console.log("release verification plan passed");
