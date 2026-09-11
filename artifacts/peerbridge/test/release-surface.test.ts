import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { featureFlags, releaseSurface } from "../src/lib/release-flags";

const execFile = promisify(execFileCallback);
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("production bundle has valid emitted references and no private markers", async () => {
  const result = await execFile(
    process.execPath,
    [path.join(rootDir, "scripts/verify-peerbridge-release-bundle.mjs")],
    { cwd: rootDir },
  );
  assert.match(result.stdout, /peerbridge release bundle check passed/);
});

test("chat retains no browser message draft", async () => {
  const chatWidgetSource = await readFile(
    new URL("../src/components/ChatWidget.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(chatWidgetSource, /(?:localStorage|sessionStorage)/);
});

test("the complete learning surface is public", () => {
  assert.deepEqual(Object.values(featureFlags), Array(8).fill(true));
  assert.deepEqual(releaseSurface.appRoutes, {
    register: "/register",
    dashboard: "/dashboard",
    districts: "/districts",
    requests: "/requests",
    admin: "/admin/reports",
    matching: "/recommendations",
    practice: "/practice-lab",
    dashboardPractice: "/dashboard/practice-lab",
    analytics: "/analytics",
    scheduling: "/scheduling",
  });
});
