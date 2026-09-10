import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { getFeatureForAppLocation } from "../src/lib/release-flags";

const execFile = promisify(execFileCallback);
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("production bundle omits every endpoint outside the reduced release surface", async () => {
  const result = await execFile(
    process.execPath,
    [path.join(rootDir, "scripts/verify-peerbridge-release-bundle.mjs")],
    { cwd: rootDir },
  );
  assert.match(result.stdout, /peerbridge release bundle check passed/);
});

test("disabled chat code retains no browser message draft", async () => {
  const chatWidgetSource = await readFile(
    new URL("../src/components/ChatWidget.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(chatWidgetSource, /(?:localStorage|sessionStorage)/);
});

test("production route classifier closes every core deep link before auth", () => {
  for (const location of [
    "/register",
    "/dashboard",
    "/districts",
    "/districts/17",
    "/requests",
    "/requests/new",
    "/requests/42?view=detail",
  ]) {
    assert.equal(getFeatureForAppLocation(location), "core", location);
  }
  assert.equal(
    getFeatureForAppLocation("/dashboard?tab=practice-lab"),
    "practice",
  );
  assert.equal(getFeatureForAppLocation("/profile"), undefined);
  assert.equal(getFeatureForAppLocation("/districtship"), undefined);
});
