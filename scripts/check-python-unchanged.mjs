import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const frozenRootFiles = new Set([
  "Python.zip",
  "pyproject.toml",
  "requirements.txt",
  "uv.lock",
]);

export function findForbiddenPaths(changedPaths) {
  return changedPaths.filter(
    (path) =>
      path.startsWith("Python/") ||
      path.endsWith(".py") ||
      frozenRootFiles.has(path),
  );
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

export function main(base = process.argv[2]) {
  if (!base) throw new Error("base ref is required");

  const changed = [
    ...git("diff", "--no-renames", "--name-only", "-z", base, "--"),
    ...git("ls-files", "--others", "--exclude-standard", "-z"),
  ];
  const forbidden = findForbiddenPaths(changed);

  if (forbidden.length) {
    throw new Error(`Python freeze violated: ${forbidden.join(", ")}`);
  }

  console.log("Python freeze passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
