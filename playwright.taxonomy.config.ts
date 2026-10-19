import { defineConfig } from "@playwright/test";

// This suite intercepts every API request with fictional fixtures. No backend or
// database is started, and the browser only connects to the local UI.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "demo-taxonomy-refresh.spec.ts",
  workers: 1,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:14210", trace: "retain-on-failure" },
  webServer: {
    command:
      "pnpm --filter @workspace/peerbridge dev --host 127.0.0.1 --strictPort",
    port: 14210,
    reuseExistingServer: false,
    env: { PORT: "14210" },
  },
});
