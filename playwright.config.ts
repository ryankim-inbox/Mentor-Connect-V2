import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:14200",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @workspace/peerbridge serve",
    port: 14200,
    reuseExistingServer: false,
    env: {
      PORT: "14200",
    },
  },
});
