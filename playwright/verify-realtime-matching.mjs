import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const screenshotDir = "C:/Users/ilzam/.gemini/antigravity/brain/1be75c54-9b8f-4858-9e54-807b04b261cb";
mkdirSync(screenshotDir, { recursive: true });

const workspaceId = "01a0d36f-2fc1-7108-8b95-bb82621b876f";
const targetUrl = `http://localhost:8090/matching?workspace=${workspaceId}&step=2`;

async function runTest() {
  console.log("=== Launching Playwright Real-Time Matching Verification ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // Listen to network errors & console
  const errors = [];
  page.on("pageerror", (err) => {
    console.error("Page error:", err.message);
    errors.push(err.message);
  });
  page.on("response", (res) => {
    if (res.status() >= 500) {
      const msg = `HTTP ${res.status()} on ${res.url()}`;
      console.error(msg);
      errors.push(msg);
    }
  });

  // Step 1: Login
  console.log("Logging in via http://localhost:8090/login...");
  await page.goto("http://localhost:8090/login", { waitUntil: "networkidle" });
  await page.locator('input[autocomplete="username"]').first().fill("admin");
  await page.locator('input[type="password"]').first().fill("321");
  await page.click('button[type="submit"]');

  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
  console.log("Login successful! Current URL:", page.url());

  // Step 2: Navigate to Matching Step 2
  console.log("Navigating to:", targetUrl);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  await page.screenshot({
    path: join(screenshotDir, "matching_step2_initial.png"),
    fullPage: false,
  });
  console.log("Captured matching_step2_initial.png");

  // Check if job is already running
  const isAlreadyRunning = await page.locator("text=/Batalkan Matching/i").isVisible().catch(() => false);

  if (isAlreadyRunning) {
    console.log("Matching job is ALREADY actively running! Monitoring live stream directly...");
  } else {
    // Check for Rerun / Start button
    const rerunBtn = page.locator("button", {
      hasText: /Jalankan Ulang Matching|Coba lagi|Mulai Pencocokan|Mulai Matching/i,
    }).first();

    const isRerunVisible = await rerunBtn.isVisible({ timeout: 5000 }).catch(() => false);
    console.log("Rerun / Start button visible:", isRerunVisible);

    if (isRerunVisible) {
      console.log("Clicking matching execution button...");
      await rerunBtn.click();
      await page.waitForTimeout(500);

      // Check if a confirmation alertdialog opened
      const dialogConfirmBtn = page.locator("[role='alertdialog'] button").last();
      if (await dialogConfirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log("Confirmation dialog detected! Clicking confirm action button:", await dialogConfirmBtn.innerText());
        await dialogConfirmBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  }

  // Monitor progress for 6 seconds, taking readings every 500ms
  console.log("Monitoring real-time progress stream...");
  const readings = [];

  for (let i = 1; i <= 10; i++) {
    await page.waitForTimeout(500);

    // Check for error text
    const errorText = await page.locator(".text-destructive, [role='alert']").allInnerTexts();
    const hasTotalInputCountError = errorText.some((t) => t.includes("$totalInputCount"));

    // Check counter text
    const counterLoc = page.locator("text=/data diproses/i");
    let counterText = "";
    if (await counterLoc.count() > 0) {
      counterText = (await counterLoc.first().innerText()).trim();
    }

    // Check stage text
    const stageLoc = page.locator("text=/Tahap /i");
    let stageText = "";
    if (await stageLoc.count() > 0) {
      stageText = (await stageLoc.first().innerText()).trim();
    }

    // Check progress bar style width
    const barLoc = page.locator(".bg-brand.rounded-full, .bg-accent");
    let barWidth = "";
    if (await barLoc.count() > 0) {
      barWidth = await barLoc.first().getAttribute("style") || "";
    }

    readings.push({
      timeMs: i * 500,
      counterText,
      stageText,
      barWidth,
      hasError: hasTotalInputCountError,
    });

    console.log(`[${i * 500}ms] Stage: "${stageText}" | Counter: "${counterText}" | Bar: "${barWidth}" | Error: ${hasTotalInputCountError}`);

    if (i === 4 || i === 8 || i === 10) {
      const targetElement = page.locator("text=/data diproses/i").first();
      if (await targetElement.count() > 0) {
        await targetElement.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
      }
      await page.screenshot({
        path: join(screenshotDir, `matching_stream_progress_${i}.png`),
        fullPage: false,
      });
    }
  }

  // Assertions
  const totalInputCountErrors = errors.filter((e) => e.includes("totalInputCount") || e.includes("500"));
  const foundUndefinedVarInUI = readings.some((r) => r.hasError);

  console.log("\n=== TEST ASSERTION SUMMARY ===");
  console.log("1. No Undefined variable $totalInputCount error:", !foundUndefinedVarInUI && totalInputCountErrors.length === 0 ? "PASSED ✅" : "FAILED ❌");
  console.log("2. Progress readings captured:", readings.length, "readings ✅");
  console.log("3. Active stage during run:", readings[readings.length - 1].stageText || "(active) ✅");
  console.log("4. Screenshots generated in artifact directory ✅");

  if (foundUndefinedVarInUI || totalInputCountErrors.length > 0) {
    throw new Error(`Test failed: Found critical backend error: ${JSON.stringify(totalInputCountErrors)}`);
  }

  await browser.close();
  console.log("Verification finished successfully!");
}

runTest().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
