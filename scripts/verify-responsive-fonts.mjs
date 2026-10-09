import { chromium, devices } from "@playwright/test";
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
    current_step: 1,
    record_count: 250,
    reference_dataset_id: "ds-ref-1",
    input_dataset_id: "ds-in-1",
    owner: mockUser,
    created_at: "2026-09-22T08:00:00Z",
    updated_at: "2026-09-23T02:00:00Z",
  },
];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const iPhone = devices["iPhone 14"];
  const context = await browser.newContext({
    ...iPhone,
    viewport: { width: 390, height: 844 },
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

  console.log("Navigating to http://localhost:5173/matching ...");
  await page.goto("http://localhost:5173/matching", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // Measure fonts at 390px
  const metrics390 = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const h2 = document.querySelector("h2");
    const pageHeaderDesc = document.querySelector("h1 + p");
    const sectionDesc = document.querySelector("h2 + p");
    const stepCircle = document.querySelector("ol span.rounded-full");
    const stepIndicator = document.querySelector("ol + div");
    const fileSlotTitle = document.querySelector(".border-dashed p.font-semibold");
    const fileSlotHint = document.querySelector(".border-dashed p.leading-snug, .border-dashed p.text-muted-foreground");
    const backBtn = document.querySelector('button:has(svg.lucide-arrow-left)');
    const continueBtn = document.querySelector('button:has(svg.lucide-arrow-right)');

    return {
      h1: h1 ? { text: h1.textContent?.trim(), fontSize: window.getComputedStyle(h1).fontSize } : null,
      pageHeaderDesc: pageHeaderDesc ? { text: pageHeaderDesc.textContent?.trim(), fontSize: window.getComputedStyle(pageHeaderDesc).fontSize } : null,
      h2: h2 ? { text: h2.textContent?.trim(), fontSize: window.getComputedStyle(h2).fontSize } : null,
      sectionDesc: sectionDesc ? { text: sectionDesc.textContent?.trim(), fontSize: window.getComputedStyle(sectionDesc).fontSize } : null,
      stepCircle: stepCircle ? {
        width: window.getComputedStyle(stepCircle).width,
        height: window.getComputedStyle(stepCircle).height,
        fontSize: window.getComputedStyle(stepCircle).fontSize,
      } : null,
      stepIndicator: stepIndicator ? { text: stepIndicator.textContent?.trim().slice(0, 50), fontSize: window.getComputedStyle(stepIndicator).fontSize } : null,
      fileSlotTitle: fileSlotTitle ? { text: fileSlotTitle.textContent?.trim(), fontSize: window.getComputedStyle(fileSlotTitle).fontSize } : null,
      fileSlotHint: fileSlotHint ? { text: fileSlotHint.textContent?.trim(), fontSize: window.getComputedStyle(fileSlotHint).fontSize } : null,
      backBtn: backBtn ? { text: backBtn.textContent?.trim(), fontSize: window.getComputedStyle(backBtn).fontSize } : null,
      continueBtn: continueBtn ? { text: continueBtn.textContent?.trim(), fontSize: window.getComputedStyle(continueBtn).fontSize } : null,
      docWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  console.log("Measured Metrics at 390px:\n", JSON.stringify(metrics390, null, 2));

  const screenshot390Path = join(screenshotDir, "mobile_matching_390_verified.png");
  await page.screenshot({ path: screenshot390Path, fullPage: false });
  console.log("Saved screenshot:", screenshot390Path);

  // 360px Android test
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(1000);
  const screenshot360Path = join(screenshotDir, "mobile_matching_360_verified.png");
  await page.screenshot({ path: screenshot360Path, fullPage: false });
  console.log("Saved 360px screenshot:", screenshot360Path);

  await browser.close();
}

run().catch(console.error);
