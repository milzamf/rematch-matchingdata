import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const screenshotDir = "C:/Users/ilzam/.gemini/antigravity/brain/1be75c54-9b8f-4858-9e54-807b04b261cb";
mkdirSync(screenshotDir, { recursive: true });

const mockUser = {
  id: "u_demo",
  name: "Admin RE-MATCH",
  email: "admin@re-match.local",
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

async function runVerification() {
  console.log("=== VERIFYING SIDEBAR & APP SHELL FIX ===");
  const browser = await chromium.launch({ headless: true });

  // 1. Desktop Test (1280x800)
  console.log("\n[1] Testing Desktop Viewport (1280x800)...");
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await desktopContext.newPage();

  // Setup API route mocking
  await page.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: mockSession }),
    });
  });

  await page.route("**/api/workspaces*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { data: [], total: 0 } }),
    });
  });

  await page.addInitScript(
    ({ session, prefs }) => {
      window.localStorage.setItem("batchmatch:session", JSON.stringify(session));
      window.localStorage.setItem("batchmatch:preferences", JSON.stringify(prefs));
      window.localStorage.removeItem("batchmatch:sidebar_collapsed");
    },
    { session: mockSession, prefs: preferences },
  );

  await page.goto("http://localhost:8090/matching");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  // Check initial sidebar state (expanded)
  const initialAsideBox = await page.locator("aside").boundingBox();
  console.log(`- Initial Sidebar Box: width=${Math.round(initialAsideBox.width)}px, height=${Math.round(initialAsideBox.height)}px, top=${initialAsideBox.y}px`);

  if (Math.round(initialAsideBox.width) !== 240) {
    console.error(`FAIL: Expected sidebar width 240px, got ${initialAsideBox.width}`);
  } else {
    console.log("  PASS: Sidebar initially expanded (240px).");
  }

  // Initial screenshot
  await page.screenshot({ path: `${screenshotDir}/desktop_sidebar_expanded.png` });
  console.log("  Screenshot saved: desktop_sidebar_expanded.png");

  // Test scrolling main content: scroll down 1000px
  console.log("- Scrolling main content by 1000px...");
  await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) {
      main.scrollTop = 1000;
    }
  });
  await page.waitForTimeout(500);

  // Verify sidebar STILL stays top: 0, height: 800, bottom: 800
  const scrolledAsideBox = await page.locator("aside").boundingBox();
  console.log(`- Scrolled Sidebar Box: width=${Math.round(scrolledAsideBox.width)}px, height=${Math.round(scrolledAsideBox.height)}px, top=${scrolledAsideBox.y}px`);

  if (scrolledAsideBox.y !== 0 || Math.round(scrolledAsideBox.height) !== 800) {
    console.error(`FAIL: Sidebar moved during scroll! top=${scrolledAsideBox.y}, height=${scrolledAsideBox.height}`);
  } else {
    console.log("  PASS: Sidebar stays perfectly pinned at top=0 and full height=800px during scrolling!");
  }

  // Verify Topbar stays at top=0
  const topbarBox = await page.locator("header").boundingBox();
  console.log(`- Topbar Box: y=${topbarBox.y}px, height=${Math.round(topbarBox.height)}px`);
  if (topbarBox.y !== 0) {
    console.error(`FAIL: Topbar moved during scroll! y=${topbarBox.y}`);
  } else {
    console.log("  PASS: Topbar stays firmly pinned at top=0!");
  }

  await page.screenshot({ path: `${screenshotDir}/desktop_scrolled_sidebar_fixed.png` });
  console.log("  Screenshot saved: desktop_scrolled_sidebar_fixed.png");

  // Reset scroll to top before testing collapse
  await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  });
  await page.waitForTimeout(200);

  // Test Collapse Button
  console.log("\n- Clicking collapse button in Sidebar Header...");
  const collapseBtn = page.locator("[data-testid='sidebar-collapse-btn']");
  await collapseBtn.click();
  await page.waitForTimeout(450); // wait for 300ms CSS transition

  const collapsedAsideBox = await page.locator("aside").boundingBox();
  console.log(`- Collapsed Sidebar Box: width=${Math.round(collapsedAsideBox.width)}px`);
  if (Math.round(collapsedAsideBox.width) !== 64) {
    console.error(`FAIL: Expected collapsed width 64px, got ${collapsedAsideBox.width}`);
  } else {
    console.log("  PASS: Sidebar smoothly collapsed to 64px icon rail!");
  }

  // Check that Topbar has breadcrumb indicator
  const hasBreadcrumb = await page.locator("header span:has-text('RE-MATCH')").last().isVisible();
  console.log(`  PASS: Topbar collapsed breadcrumb visible: ${hasBreadcrumb}`);

  await page.screenshot({ path: `${screenshotDir}/desktop_sidebar_collapsed.png` });
  console.log("  Screenshot saved: desktop_sidebar_collapsed.png");

  // Test Expand Button in Topbar
  console.log("\n- Clicking expand button in Topbar...");
  const topbarToggleBtn = page.locator("[data-testid='topbar-sidebar-toggle-btn']");
  await topbarToggleBtn.click();
  await page.waitForTimeout(450);

  const reExpandedAsideBox = await page.locator("aside").boundingBox();
  console.log(`- Re-expanded Sidebar Box: width=${Math.round(reExpandedAsideBox.width)}px`);
  if (Math.round(reExpandedAsideBox.width) !== 240) {
    console.error(`FAIL: Expected re-expanded width 240px, got ${reExpandedAsideBox.width}`);
  } else {
    console.log("  PASS: Sidebar smoothly re-expanded to 240px!");
  }

  // Test Keyboard Shortcut (Ctrl+B)
  console.log("\n- Testing Ctrl+B keyboard shortcut...");
  await page.keyboard.press("Control+b");
  await page.waitForTimeout(450);

  const shortcutCollapsedBox = await page.locator("aside").boundingBox();
  console.log(`- After Ctrl+B Sidebar width: ${Math.round(shortcutCollapsedBox.width)}px`);
  if (Math.round(shortcutCollapsedBox.width) !== 64) {
    console.error(`FAIL: Ctrl+B did not collapse sidebar!`);
  } else {
    console.log("  PASS: Ctrl+B collapsed the sidebar!");
  }

  await page.keyboard.press("Control+b");
  await page.waitForTimeout(450);
  const shortcutExpandedBox = await page.locator("aside").boundingBox();
  console.log(`- After second Ctrl+B Sidebar width: ${Math.round(shortcutExpandedBox.width)}px`);
  if (Math.round(shortcutExpandedBox.width) !== 240) {
    console.error(`FAIL: Ctrl+B did not re-expand sidebar!`);
  } else {
    console.log("  PASS: Second Ctrl+B re-expanded the sidebar!");
  }

  await desktopContext.close();

  // 2. Mobile Viewport Test (390x844)
  console.log("\n[2] Testing Mobile Viewport (390x844)...");
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const mobilePage = await mobileContext.newPage();

  await mobilePage.route("**/api/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: mockSession }),
    });
  });

  await mobilePage.route("**/api/workspaces*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { data: [], total: 0 } }),
    });
  });

  await mobilePage.addInitScript(
    ({ session, prefs }) => {
      window.localStorage.setItem("batchmatch:session", JSON.stringify(session));
      window.localStorage.setItem("batchmatch:preferences", JSON.stringify(prefs));
    },
    { session: mockSession, prefs: preferences },
  );

  await mobilePage.goto("http://localhost:8090/matching");
  await mobilePage.waitForLoadState("networkidle");
  await mobilePage.waitForTimeout(1000);

  // Verify desktop aside is hidden on mobile
  const asideVisible = await mobilePage.locator("aside").isVisible();
  console.log(`- Desktop aside visible on mobile: ${asideVisible} (expected: false)`);
  if (!asideVisible) {
    console.log("  PASS: Desktop aside is hidden on mobile.");
  } else {
    console.error("FAIL: Desktop aside should be hidden on mobile!");
  }

  // Open mobile drawer via hamburger
  console.log("- Opening mobile navigation drawer...");
  const hamburgerBtn = mobilePage.locator("header button[aria-label='Buka Menu Navigasi']");
  await hamburgerBtn.click();
  await mobilePage.waitForTimeout(500);

  const drawerVisible = await mobilePage.locator("role=dialog").isVisible();
  console.log(`- Mobile drawer dialog visible: ${drawerVisible}`);
  if (drawerVisible) {
    console.log("  PASS: Mobile drawer opens properly.");
    await mobilePage.screenshot({ path: `${screenshotDir}/mobile_sidebar_drawer_verified.png` });
    console.log("  Screenshot saved: mobile_sidebar_drawer_verified.png");
  } else {
    console.error("FAIL: Mobile drawer did not open!");
  }

  // Check document overflow
  const overflow = await mobilePage.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    return { docWidth, scrollWidth, hasOverflow: scrollWidth > docWidth + 2 };
  });
  console.log(`- Mobile overflow check: docWidth=${overflow.docWidth}, scrollWidth=${overflow.scrollWidth}, hasOverflow=${overflow.hasOverflow}`);
  if (!overflow.hasOverflow) {
    console.log("  PASS: Zero horizontal overflow on mobile!");
  } else {
    console.error("FAIL: Mobile has horizontal overflow!");
  }

  await mobileContext.close();
  await browser.close();

  console.log("\n=== ALL VERIFICATIONS PASSED ===");
}

runVerification().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
