import { defineConfig, devices } from "@playwright/test";

const legacy = process.env.STAGE5B_LEGACY === "true";

export default defineConfig({
  testDir: "./playwright/stage5b",
  testMatch: legacy ? "**/legacy.spec.ts" : "**/workspace-access.spec.ts",
  timeout: 30_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5177", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5177",
    url: "http://127.0.0.1:5177",
    reuseExistingServer: false,
    timeout: 120_000,
    // This server cannot proxy to the primary backend. All API traffic is mocked.
    env: {
      VITE_WORKSPACE_SHARING_UI: legacy ? "false" : "true",
      VITE_STAGE5B_TEST_FIXTURE: "true",
      VITE_API_BASE_URL: "/api",
      VITE_API_PROXY_TARGET: "http://127.0.0.1:9",
    },
  },
});
