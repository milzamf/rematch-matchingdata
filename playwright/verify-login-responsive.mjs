import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const screenshotDir = "C:/Users/ilzam/.gemini/antigravity/brain/1be75c54-9b8f-4858-9e54-807b04b261cb";
mkdirSync(screenshotDir, { recursive: true });

async function run() {
  const browser = await chromium.launch({ headless: true });

  // 1. Desktop Test (1280x800)
  console.log("Testing Desktop (1280x800)...");
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const desktopPage = await desktopContext.newPage();

  desktopPage.on("console", (msg) => console.log("DESKTOP LOG:", msg.text()));
  desktopPage.on("pageerror", (err) => console.error("DESKTOP PAGE ERROR:", err));
  desktopPage.on("response", (res) => {
    if (res.url().includes("/api/")) {
      console.log("DESKTOP API:", res.status(), res.url());
    }
  });

  await desktopPage.goto("http://localhost:8090/login", { waitUntil: "networkidle" });
  await desktopPage.waitForTimeout(2000);

  // Check branding unit text
  const orgUnitEl = desktopPage.locator("text=Direktorat Statistik Sumber Daya Mineral dan Konstruksi");
  const orgUnitVisible = await orgUnitEl.isVisible();
  console.log("Desktop Org Unit Visible:", orgUnitVisible);

  // Check label
  const labelText = await desktopPage.locator("label span").first().textContent();
  console.log("Desktop First Input Label:", labelText?.trim());

  await desktopPage.screenshot({
    path: join(screenshotDir, "login_desktop_1280.png"),
    fullPage: true,
  });

  // Test login with 'admin' and '321' (no @)
  const identifierInput = desktopPage.locator('input[autocomplete="username"]').first();
  const passwordInput = desktopPage.locator('input[type="password"]').first();
  await identifierInput.fill("admin");
  await passwordInput.fill("321");
  await desktopPage.waitForTimeout(500);

  await desktopPage.click('button[type="submit"]');

  await desktopPage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
  console.log("Desktop Admin Login Succeeded! Redirected to:", desktopPage.url());
  await desktopPage.waitForTimeout(2000);

  await desktopPage.screenshot({
    path: join(screenshotDir, "desktop_admin_dashboard.png"),
  });
  await desktopContext.close();

  // 2. Tablet Test (768x1024)
  console.log("Testing Tablet (768x1024)...");
  const tabletContext = await browser.newContext({
    viewport: { width: 768, height: 1024 },
  });
  const tabletPage = await tabletContext.newPage();
  await tabletPage.goto("http://localhost:8090/login", { waitUntil: "networkidle" });
  await tabletPage.waitForTimeout(1000);

  await tabletPage.screenshot({
    path: join(screenshotDir, "login_tablet_768.png"),
    fullPage: true,
  });
  await tabletContext.close();

  // 3. Mobile Test (390x844 - iPhone 13)
  console.log("Testing Mobile (390x844)...");
  const mobileContext = await browser.newContext({
    ...devices["iPhone 13"],
  });
  const mobilePage = await mobileContext.newPage();

  mobilePage.on("console", (msg) => console.log("MOBILE LOG:", msg.text()));
  mobilePage.on("pageerror", (err) => console.error("MOBILE PAGE ERROR:", err));
  mobilePage.on("response", (res) => {
    if (res.url().includes("/api/")) {
      console.log("MOBILE API:", res.status(), res.url());
    }
  });

  await mobilePage.goto("http://localhost:8090/login", { waitUntil: "networkidle" });
  await mobilePage.waitForTimeout(1000);

  await mobilePage.screenshot({
    path: join(screenshotDir, "login_mobile_390.png"),
    fullPage: true,
  });

  // Test mobile login with 'user' and '321'
  const mobIdentifier = mobilePage.locator('input[autocomplete="username"]').first();
  const mobPassword = mobilePage.locator('input[type="password"]').first();
  await mobIdentifier.fill("user");
  await mobPassword.fill("321");
  await mobilePage.waitForTimeout(500);

  await mobilePage.click('button[type="submit"]');

  await mobilePage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
  console.log("Mobile User Login Succeeded! Redirected to:", mobilePage.url());
  await mobilePage.waitForTimeout(2000);

  await mobilePage.screenshot({
    path: join(screenshotDir, "mobile_user_dashboard.png"),
  });

  await mobileContext.close();
  await browser.close();
  console.log("All Playwright verification tests passed successfully!");
}

run().catch((err) => {
  console.error("Playwright test error:", err);
  process.exit(1);
});
