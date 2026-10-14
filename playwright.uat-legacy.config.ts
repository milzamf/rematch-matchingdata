import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./playwright/shared-integration",
  testMatch: "**/real-legacy.spec.ts",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5179", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5179",
    url: "http://127.0.0.1:5179",
    reuseExistingServer: process.env.REMATCH_UAT_EXTERNAL_SERVER === "true",
    timeout: 120_000,
    env: {
      VITE_WORKSPACE_SHARING_UI: "false",
      VITE_API_BASE_URL: "/api",
      VITE_API_PROXY_TARGET: "http://127.0.0.1:5189",
    },
  },
});
