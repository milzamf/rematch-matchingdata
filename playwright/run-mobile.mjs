import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const screenshotDir = "C:/Users/ilzam/.gemini/antigravity/brain/1be75c54-9b8f-4858-9e54-807b04b261cb";

const mockUser = {
  id: "u_demo",
  name: "Andi Setiawan",
  email: "andi@demo.id",
  role: "admin",
};

const mockPermissions = [
  "dashboard.view",
  "workspace.view",
  "workspace.create",
  "workspace.update",
  "workspace.delete",
  "matching.view",
  "matching.create",
  "matching.configure",
  "matching.run",
  "review.view",
  "review.decide",
  "sync.view",
  "sync.execute",
  "export.view",
  "export.execute",
  "monitoring.view",
  "admin.access",
];

const mockSession = {
  user: mockUser,
  permissions: mockPermissions,
};

const preferences = {
  theme: "light",
  language: "id",
};

const mockWorkspaces = [
  {
    id: "ws-1",
    name: "Sensus Konstruksi Tahap 1",
    status: "needs_review",
    current_step: 3,
    record_count: 250,
    reference_dataset_id: "ds-ref-1",
    input_dataset_id: "ds-in-1",
    matching_job_id: "job-1",
    matching_job: {
      id: "job-1",
      name: "Job Sensus Konstruksi",
      status: "completed",
      processed_count: 250,
      total_count: 250,
      record_counts: { needs_review: 42, matched: 180, unmatched: 28 },
      error_message: null,
      started_at: "2026-09-23T01:00:00Z",
      finished_at: "2026-09-23T01:05:00Z",
    },
    owner: mockUser,
    workflow_state: null,
    sync_state: null,
    export_history: null,
    reference_dataset: null,
    input_dataset: null,
    created_at: "2026-09-22T08:00:00Z",
    updated_at: "2026-09-23T02:00:00Z",
  },
  {
    id: "ws-2",
    name: "Validasi Profil Tambang Batubara 2026",
    status: "processing",
    current_step: 2,
    record_count: 1800,
    reference_dataset_id: "ds-ref-2",
    input_dataset_id: "ds-in-2",
    matching_job_id: "job-2",
    matching_job: {
      id: "job-2",
      name: "Job Validasi Tambang",
      status: "processing",
      processed_count: 900,
      total_count: 1800,
      record_counts: {},
      error_message: null,
      started_at: "2026-09-23T01:30:00Z",
      finished_at: null,
    },
    owner: mockUser,
    workflow_state: null,
    sync_state: null,
    export_history: null,
    reference_dataset: null,
    input_dataset: null,
    created_at: "2026-09-21T08:00:00Z",
    updated_at: "2026-09-22T14:00:00Z",
  },
  {
    id: "ws-3",
    name: "Rekonsiliasi Vendor Energi Terbarukan",
    status: "completed",
    current_step: 4,
    record_count: 940,
    reference_dataset_id: "ds-ref-3",
    input_dataset_id: "ds-in-3",
    matching_job_id: "job-3",
    matching_job: {
      id: "job-3",
      name: "Job Rekonsiliasi",
      status: "completed",
      processed_count: 940,
      total_count: 940,
      record_counts: { matched: 800, unmatched: 140 },
      error_message: null,
      started_at: "2026-09-20T08:00:00Z",
      finished_at: "2026-09-20T08:10:00Z",
    },
    owner: mockUser,
    workflow_state: null,
    sync_state: null,
    export_history: null,
    reference_dataset: null,
    input_dataset: null,
    created_at: "2026-09-20T08:00:00Z",
    updated_at: "2026-09-21T10:00:00Z",
  },
];

async function testMobile() {
  const browser = await chromium.launch({ headless: true });
  const iPhone = devices["iPhone 14"];
  const context = await browser.newContext({
    ...iPhone,
    viewport: { width: 390, height: 844 },
  });

  const mockMonitoringOverview = {
    summary: {
      total_workspaces: 3,
      active_workspaces: 2,
      pending_review_total: 42,
      status_counts: {
        needs_review: 1,
        processing: 1,
        completed: 1,
      },
    },
    owner_breakdown: [
      {
        owner: "Andi Setiawan",
        user_id: "u_demo",
        role: "admin",
        workspace_count: 3,
        pending_review: 42,
      },
    ],
    recent_workspaces: [
      {
        id: "ws-1",
        name: "Sensus Konstruksi Tahap 1",
        status: "needs_review",
        current_step: 3,
        record_count: 250,
        pending_review: 42,
        owner: mockUser,
        updated_at: "2026-09-23T02:00:00Z",
      },
      {
        id: "ws-2",
        name: "Validasi Profil Tambang Batubara 2026",
        status: "processing",
        current_step: 2,
        record_count: 1800,
        pending_review: 0,
        owner: mockUser,
        updated_at: "2026-09-22T14:00:00Z",
      },
    ],
  };

  const mockAdminUsers = [
    {
      id: "u_demo",
      name: "Andi Setiawan",
      email: "andi@demo.id",
      role: "admin",
      workspace_count: 3,
      dataset_count: 6,
      matching_job_count: 3,
      created_at: "2026-09-01T08:00:00Z",
      updated_at: "2026-09-23T02:00:00Z",
    },
    {
      id: "u_user2",
      name: "Budi Santoso",
      email: "budi@bps.go.id",
      role: "user",
      workspace_count: 1,
      dataset_count: 2,
      matching_job_count: 1,
      created_at: "2026-09-10T08:00:00Z",
      updated_at: "2026-09-22T10:00:00Z",
    },
  ];

  await context.route("**/api/monitoring/overview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: mockMonitoringOverview }),
    });
  });

  await context.route("**/api/admin/users", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: mockAdminUsers }),
    });
  });

  await context.route("**/api/admin/workspaces", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: mockWorkspaces }),
    });
  });

  await context.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: mockSession }),
    });
  });

  await context.route("**/api/workspaces", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: mockWorkspaces }),
    });
  });

  await context.addInitScript(
    ({ session, prefs }) => {
      window.localStorage.setItem("rematch_auth_session", JSON.stringify(session));
      window.localStorage.setItem("batchmatch:preferences", JSON.stringify(prefs));
    },
    { session: mockSession, prefs: preferences },
  );

  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message, err.stack));
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      console.log(`PAGE ${msg.type().toUpperCase()}:`, msg.text());
    }
  });
  page.on("requestfailed", (req) => console.log("FAILED REQ:", req.url(), req.failure()?.errorText));
  page.on("response", (res) => {
    if (res.status() >= 400) console.log("HTTP ERROR:", res.status(), res.url());
  });

  async function checkPage(path, name) {
    console.log(`Checking ${path} (${name}) on 390px ...`);
    await page.goto(`http://127.0.0.1:5174${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const overflow = await page.evaluate(() => {
      const docWidth = document.documentElement.clientWidth;
      const scrollWidth = document.documentElement.scrollWidth;
      const overflowingElements = [];

      document.querySelectorAll("*").forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.right > docWidth + 2) {
          overflowingElements.push({
            tag: el.tagName,
            className: String(el.className || "").slice(0, 80),
            width: Math.round(rect.width),
            right: Math.round(rect.right),
            text: (el.textContent || "").trim().slice(0, 40),
          });
        }
      });

      return {
        docWidth,
        scrollWidth,
        hasOverflow: scrollWidth > docWidth + 2,
        overflowingElements: overflowingElements.slice(0, 10),
      };
    });

    console.log(`[${name}] Overflow:`, overflow.hasOverflow ? "FAIL" : "PASS", `(doc: ${overflow.docWidth}, scroll: ${overflow.scrollWidth})`);
    if (overflow.hasOverflow) {
      console.log("Overflowing items:", JSON.stringify(overflow.overflowingElements, null, 2));
    }

    await page.screenshot({
      path: join(screenshotDir, `mobile_${name}.png`),
      fullPage: true,
    });
    console.log(`Screenshot saved: mobile_${name}.png`);
  }

  await checkPage("/", "dashboard");
  await checkPage("/workspaces", "workspaces");
  await checkPage("/matching", "matching");
  await checkPage("/monitoring", "monitoring");
  await checkPage("/admin", "admin");
  await checkPage("/settings", "settings");

  // Check mobile navigation drawer open
  console.log("Testing mobile drawer toggle on dashboard...");
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const hamburger = page.locator('button[aria-label="Buka Menu Navigasi"]');
  if (await hamburger.isVisible()) {
    await hamburger.click();
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: join(screenshotDir, "mobile_drawer_open.png"),
    });
    console.log("Screenshot saved: mobile_drawer_open.png");
  }

  // Now test Android 360px viewport (the strictest common phone width!)
  console.log("\nTesting 360px narrow viewport...");
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const narrow360Overflow = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    return {
      docWidth,
      scrollWidth,
      hasOverflow: scrollWidth > docWidth + 2,
    };
  });
  console.log("[360px Dashboard] Overflow:", narrow360Overflow.hasOverflow ? "FAIL" : "PASS", narrow360Overflow);

  await page.screenshot({
    path: join(screenshotDir, "mobile_360_dashboard.png"),
    fullPage: true,
  });
  console.log("Screenshot saved: mobile_360_dashboard.png");

  await browser.close();
}

testMobile().catch(console.error);
