import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = path.join(rootDir, "artifacts/peerbridge/dist/public");
const manifestPath = path.join(bundleDir, ".vite/manifest.json");
const scannedExtensions = new Set([".css", ".html", ".js", ".json", ".map"]);
const forbiddenMarkers = [
  "demo@berkeley.edu",
  "password123",
  "127.0.0.1:8181",
  "localhost:8181",
  "GATEWAY_UPSTREAM_ORIGIN",
  "127.0.0.1:8000",
  "localhost:8000",
];

async function listBundleFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listBundleFiles(absolutePath)));
    if (entry.isFile() && scannedExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function assertFile(reference, owner) {
  const absolutePath = path.resolve(bundleDir, reference.replace(/^\//, ""));
  const relativePath = path.relative(bundleDir, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${owner} references a file outside the bundle: ${reference}`);
  }
  await access(absolutePath).catch(() => {
    throw new Error(`${owner} references a missing file: ${reference}`);
  });
}

let files;
let manifest;
try {
  [files, manifest] = await Promise.all([
    listBundleFiles(bundleDir),
    readFile(manifestPath, "utf8").then(JSON.parse),
  ]);
} catch (error) {
  console.error(
    `peerbridge release bundle check failed: ${error instanceof Error ? error.message : "production bundle is missing"}`,
  );
  process.exit(1);
}

try {
  if (!manifest || typeof manifest !== "object" || !("index.html" in manifest)) {
    throw new Error("Vite manifest has no index.html entry");
  }

  for (const [key, entry] of Object.entries(manifest)) {
    if (!entry || typeof entry !== "object" || typeof entry.file !== "string") {
      throw new Error(`Vite manifest entry ${key} has no emitted file`);
    }
    await assertFile(entry.file, `manifest entry ${key}`);
    for (const reference of [...(entry.css ?? []), ...(entry.assets ?? [])]) {
      await assertFile(reference, `manifest entry ${key}`);
    }
    for (const importedKey of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) {
      if (!(importedKey in manifest)) {
        throw new Error(`manifest entry ${key} references missing chunk ${importedKey}`);
      }
    }
  }

  const indexHtml = await readFile(path.join(bundleDir, "index.html"), "utf8");
  for (const match of indexHtml.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const reference = match[1];
    if (!reference.startsWith("http:") && !reference.startsWith("https:") && !reference.startsWith("data:")) {
      await assertFile(reference, "index.html");
    }
  }

  for (const file of files) {
    const contents = await readFile(file, "utf8");
    for (const marker of forbiddenMarkers) {
      if (contents.includes(marker)) {
        throw new Error(`${path.relative(bundleDir, file)} contains ${marker}`);
      }
    }
  }
} catch (error) {
  console.error(
    `peerbridge release bundle check failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

console.log(
  `peerbridge release bundle check passed (${files.length} files, ${Object.keys(manifest).length} manifest entries)`,
);
