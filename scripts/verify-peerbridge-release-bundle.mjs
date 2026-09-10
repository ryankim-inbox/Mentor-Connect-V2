import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const bundleDir = path.join(rootDir, "artifacts/peerbridge/dist");
const scannedExtensions = new Set([".css", ".html", ".js", ".json", ".map"]);
const forbiddenMarkers = [
  "/api/admin",
  "/api/chat",
  "/api/districts",
  "/api/dms",
  "/api/matches",
  "/api/practice",
  "/api/python-reports",
  "/api/requests",
  "/api/scheduling",
  "/api/stats",
  "/ws/",
  "demo@berkeley.edu",
  "password123",
];

async function listBundleFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory())
      files.push(...(await listBundleFiles(absolutePath)));
    if (entry.isFile() && scannedExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }
  return files;
}

let files;
try {
  files = await listBundleFiles(bundleDir);
} catch {
  console.error(
    "peerbridge release bundle check failed: production bundle is missing",
  );
  process.exit(1);
}

const matches = [];
for (const file of files) {
  const contents = await readFile(file, "utf8");
  for (const marker of forbiddenMarkers) {
    if (contents.includes(marker)) {
      matches.push({ file: path.relative(bundleDir, file), marker });
    }
  }
}

if (matches.length > 0) {
  for (const match of matches) {
    console.error(
      `peerbridge release bundle check failed: ${match.file} contains ${match.marker}`,
    );
  }
  process.exit(1);
}

console.log(
  `peerbridge release bundle check passed (${files.length} files, ${forbiddenMarkers.length} forbidden markers)`,
);
