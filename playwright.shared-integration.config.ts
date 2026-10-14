import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./playwright/shared-integration",
  testIgnore: ["**/real-legacy.spec.ts", "**/login-hydration.spec.ts"],
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5178",
    trace: "off",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "node --max-http-header-size=65536 ./node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 5178",
    url: "http://127.0.0.1:5178",
    reuseExistingServer: process.env.REMATCH_UAT_EXTERNAL_SERVER === "true",
    timeout: 120_000,
    env: {
      VITE_WORKSPACE_SHARING_UI: "true",
      VITE_API_BASE_URL: "/api",
      VITE_API_PROXY_TARGET: "http://127.0.0.1:5188",
    },
  },
});
