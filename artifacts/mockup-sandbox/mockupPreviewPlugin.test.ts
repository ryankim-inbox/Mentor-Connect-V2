import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin.ts";

// Exercise the real Vite lifecycle and emitted module, without exporting discovery internals.
test("preview discovery preserves public TSX files and refreshes additions/removals", async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "mockup-preview-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const mockups = path.join(root, "src/components/mockups");
  const write = (name: string) => {
    const file = path.join(mockups, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "export default function Mockup() { return null; }\n");
  };
  for (const name of [
    "Visible.tsx",
    "nested/Card.tsx",
    "_Private.tsx",
    "_private/Hidden.tsx",
    "nested/_Secret.tsx",
    ".Hidden.tsx",
    ".hidden/Hidden.tsx",
    "Other.ts",
  ])
    write(name);
  mkdirSync(path.join(mockups, "Directory.tsx"));
  symlinkSync("Visible.tsx", path.join(mockups, "Linked.tsx"));
  symlinkSync("nested", path.join(mockups, "linked"));
  symlinkSync("missing.tsx", path.join(mockups, "Broken.tsx"));
  const plugin = mockupPreviewPlugin();
  const hook = (name: "configResolved" | "buildStart") => {
    const value = plugin[name];
    assert.ok(value);
    return typeof value === "function" ? value : value.handler;
  };
  await hook("configResolved").call({} as never, { root } as never);
  const entries = () =>
    [
      ...readFileSync(
        path.join(root, "src/.generated/mockup-components.ts"),
        "utf8",
      ).matchAll(/"([^"\n]+)": \(\) => import\("([^"\n]+)"\)/g),
    ]
      .map((match) => [match[1], match[2]])
      .sort();
  const initial = [
    ["./components/mockups/Linked.tsx", "../components/mockups/Linked.tsx"],
    ["./components/mockups/Visible.tsx", "../components/mockups/Visible.tsx"],
    [
      "./components/mockups/linked/Card.tsx",
      "../components/mockups/linked/Card.tsx",
    ],
    [
      "./components/mockups/nested/Card.tsx",
      "../components/mockups/nested/Card.tsx",
    ],
  ];
  await hook("buildStart").call({} as never, {} as never);
  assert.deepEqual(entries(), initial);
  write("Added.tsx");
  rmSync(path.join(mockups, "Visible.tsx"));
  await hook("buildStart").call({} as never, {} as never);
  assert.deepEqual(entries(), [
    ["./components/mockups/Added.tsx", "../components/mockups/Added.tsx"],
    initial[2],
    initial[3],
  ]);
});
