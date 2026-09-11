import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RELEASE_SHA = /^[a-f0-9]{7,64}$/;
const MIGRATION_ID = /^\d{4,}_[a-z0-9_]+$/;

export async function writeReleaseMetadata({ rootDir, releaseSha } = {}) {
  const repositoryRoot =
    rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const version = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "database/schema/version.json"),
      "utf8",
    ),
  );
  const currentMigrationId = version.currentMigrationId;
  if (!MIGRATION_ID.test(currentMigrationId ?? "")) {
    throw new Error("schema version has an invalid currentMigrationId");
  }

  const resolvedReleaseSha =
    releaseSha ??
    process.env.RELEASE_SHA ??
    (
      await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      })
    ).stdout.trim();
  if (!RELEASE_SHA.test(resolvedReleaseSha)) {
    throw new Error(
      "RELEASE_SHA must be a 7-64 character lowercase hexadecimal SHA",
    );
  }

  const outputDirectory = path.join(
    repositoryRoot,
    "artifacts/api-gateway/dist",
  );
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, "release.json"),
    `${JSON.stringify({ currentMigrationId, releaseSha: resolvedReleaseSha }, null, 2)}\n`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  await writeReleaseMetadata();
}
