import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("loads the chat widget only through a development-only module", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const chatWidgetSource = await readFile(new URL("../src/components/ChatWidget.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(appSource, /import \{ ChatWidget \} from "@\/components\/ChatWidget"/);
  assert.match(
    appSource,
    /const DevelopmentChatWidget = import\.meta\.env\.DEV\s*\?\s*lazy\(\(\) => import\("@\/components\/ChatWidget"\)\.then/s,
  );
  assert.match(appSource, /DevelopmentChatWidget && isFeatureEnabled\("chat"\)/);
  assert.doesNotMatch(chatWidgetSource, /(?:localStorage|sessionStorage)/);
});
