import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const screenshotDir = "C:/Users/ilzam/.gemini/antigravity/brain/20a15753-7f6e-45cf-ba26-cc854f6f7468";
mkdirSync(screenshotDir, { recursive: true });

async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    console.log("1. Navigating to login page...");
    await page.goto("http://localhost:8090/login", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    console.log("2. Logging in as admin...");
    await page.locator('input[autocomplete="username"]').first().fill("admin");
    await page.locator('input[type="password"]').first().fill("321");
    await page.click('button[type="submit"]');

    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
    console.log("   Logged in successfully. URL:", page.url());

    console.log("3. Navigating to matching review step 3...");
    await page.goto("http://localhost:8090/matching?workspace=01a0d08d-9a4c-71db-a0ae-adab333cfd77&step=3", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);

    await page.screenshot({
      path: join(screenshotDir, "matching_step3_review.png"),
      fullPage: false,
    });
    console.log("   Saved matching_step3_review.png");

    // Check Case Groups and Diagnostics
    const caseGroupsHeader = page.locator("text=/Kelompok Kasus|Case Groups/i").first();
    if (await caseGroupsHeader.count() > 0) {
      console.log("   ✓ Found 'Kelompok Kasus' section!");
    }

    console.log("4. Checking review view if accessible...");
    const currentUrl = page.url();
    console.log("   Current URL:", currentUrl);

    console.log("=== Playwright verification complete ===");
  } catch (error) {
    console.error("Playwright verification error:", error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
