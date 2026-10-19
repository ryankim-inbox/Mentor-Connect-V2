#!/usr/bin/env node
// Review artifact only: no database, environment secrets, or real receipt IDs.
import { writeFile } from "node:fs/promises";
import {
  buildDemoContentPreview,
  demoRefreshDigest,
} from "./demo-refresh-plan.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output") {
  process.stderr.write(
    "Usage: node ops/export-demo-refresh-preview.mjs --output <preview.json>\n",
  );
  process.exitCode = 1;
} else {
  const preview = buildDemoContentPreview();
  const artifact = { ...preview, contentDigest: demoRefreshDigest(preview) };
  await writeFile(args[1], `${JSON.stringify(artifact, null, 2)}\n`, {
    flag: "w",
    mode: 0o644,
  });
  process.stdout.write(
    `${JSON.stringify({ output: args[1], profiles: preview.profiles.length, requests: preview.requests.length, contentDigest: artifact.contentDigest, summary: preview.summary })}\n`,
  );
}
