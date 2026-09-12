import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { findForbiddenPaths } from "./check-python-unchanged.mjs";

const cases = [
  ["modification", ["Python/main.py"], ["Python/main.py"]],
  ["addition", ["tests/new_test.py"], ["tests/new_test.py"]],
  ["deletion", ["uv.lock"], ["uv.lock"]],
  [
    "rename source and destination",
    ["Python/old_name.py", "docs/new_name.md"],
    ["Python/old_name.py"],
  ],
  [
    "rename destination",
    ["docs/old_name.md", "Python/new_name.py"],
    ["Python/new_name.py"],
  ],
];

for (const [name, changed, expected] of cases) {
  test(`rejects a Python freeze ${name}`, () => {
    assert.deepEqual(findForbiddenPaths(changed), expected);
  });
}

test("allows non-Python changes", () => {
  assert.deepEqual(
    findForbiddenPaths(["package.json", "scripts/check-python-unchanged.mjs"]),
    [],
  );
});

test("CLI passes against HEAD", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-python-unchanged.mjs", "HEAD"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Python freeze passed/);
});

test("CLI rejects a historical base containing Python changes", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/check-python-unchanged.mjs",
      "98e1b04c292302bd25365ed7db4c5675671df337^",
    ],
    { encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Python freeze violated/);
});
