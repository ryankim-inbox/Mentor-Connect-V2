import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:14200",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node e2e/fixtures.mjs",
      port: 18181,
      reuseExistingServer: false,
    },
    {
      command: "node artifacts/api-gateway/dist/index.js",
      port: 18080,
      reuseExistingServer: false,
      env: {
        PORT: "18080",
        GATEWAY_UPSTREAM_ORIGIN: "http://127.0.0.1:18181",
        GATEWAY_PUBLIC_ORIGIN: "http://127.0.0.1:14200",
        NODE_ENV: "test",
      },
    },
    {
      command: "pnpm --filter @workspace/peerbridge serve --strictPort",
      port: 14200,
      reuseExistingServer: false,
      env: {
        PORT: "14200",
        VITE_API_PROXY_TARGET: "http://127.0.0.1:18080",
      },
    },
  ],
});
