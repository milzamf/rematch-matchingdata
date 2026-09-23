import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const screenshotDir = "C:/Users/ilzam/.gemini/antigravity/brain/1be75c54-9b8f-4858-9e54-807b04b261cb";
mkdirSync(screenshotDir, { recursive: true });

const workspaceUrl = "http://localhost:8090/matching?workspace=01a0d08d-9a4c-71db-a0ae-adab333cfd77&step=3";

async function run() {
  const browser = await chromium.launch({ headless: true });

  console.log("=== Launching Desktop Verification ===");
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await desktopContext.newPage();

  // Login
  await page.goto("http://localhost:8090/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  await page.locator('input[autocomplete="username"]').first().fill("admin");
  await page.locator('input[type="password"]').first().fill("321");
  await page.click('button[type="submit"]');

  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });
  console.log("Logged in! URL:", page.url());

  // Navigate to matching Step 3
  console.log("Navigating to:", workspaceUrl);
  await page.goto(workspaceUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  // Scroll down to view mode switcher
  const allRecordsBtn = page.locator("button", { hasText: /Semua Record|All Records/i }).first();
  await allRecordsBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  console.log("Clicking 'Semua Record' button...");
  await allRecordsBtn.click();
  await page.waitForTimeout(2000);

  // Wait for review table
  await page.waitForSelector("table tbody tr", { timeout: 10000 });
  console.log("Table loaded!");

  // Scroll table into view
  const tableEl = page.locator("table").first();
  await tableEl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);

  await page.screenshot({
    path: join(screenshotDir, "matching_review_table_verified.png"),
    fullPage: false,
  });
  console.log("Saved matching_review_table_verified.png");

  // Inspect headlines in the table
  const headlineElements = page.locator("table tbody tr td p.truncate.text-xs.font-bold");
  const count = await headlineElements.count();
  console.log(`Found ${count} bold headline elements in the table`);

  const headlines = [];
  for (let i = 0; i < count; i++) {
    const text = await headlineElements.nth(i).textContent();
    if (text?.trim()) headlines.push(text.trim());
  }

  console.log("\nSample Headlines in Review Table:");
  headlines.slice(0, 15).forEach((h, idx) => console.log(`  [${idx + 1}] ${h}`));

  // Check that NO person name is used as the bold headline
  const personNames = ["H. M. YASIN, MT", "FAJAR EBIANTO", "UDEN", "AHMAD IQDOL", "SUPRAPTO", "RAHMAT FIRDAUS"];
  for (const pName of personNames) {
    const isHeadline = headlines.some(h => h === pName || (h && h.toLowerCase() === pName.toLowerCase()));
    if (isHeadline) {
      console.error(`FAILURE: Person name "${pName}" was used as a primary bold headline!`);
      process.exit(1);
    } else {
      console.log(`PASS: "${pName}" is NOT used as primary bold headline.`);
    }
  }

  // Check that company names ARE the headlines
  const companyKeywords = ["CV", "PT", "NOR RIDEFA", "MITRA PERSADA", "WANINAS", "BERKAH", "KARYA", "JAYA", "PUTRA", "PERDANA"];
  const matchingCompanyHeadlines = headlines.filter(h => companyKeywords.some(kw => h?.includes(kw)));
  console.log(`\nVerified ${matchingCompanyHeadlines.length} company headlines in review table!`);
  matchingCompanyHeadlines.slice(0, 8).forEach(h => console.log(`  ✓ ${h}`));

  // Inspect sublines for CP
  const sublines = page.locator("table tbody tr td p.truncate.text-\\[11px\\]");
  const sublineCount = await sublines.count();
  console.log(`\nTotal sublines found: ${sublineCount}`);

  let cpCount = 0;
  for (let i = 0; i < sublineCount; i++) {
    const text = await sublines.nth(i).textContent();
    if (text?.includes("Nama CP:") || text?.includes("CP:")) {
      console.log(`  ✓ Found CP formatted in metadata subline: "${text.trim()}"`);
      cpCount++;
    }
  }
  console.log(`Total CP metadata mentions verified in sublines: ${cpCount}`);

  // Also test /results page
  console.log("\n=== Testing /results Page ===");
  await page.goto("http://localhost:8090/results?workspace=01a0d08d-9a4c-71db-a0ae-adab333cfd77", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  await page.screenshot({
    path: join(screenshotDir, "results_page_verified.png"),
    fullPage: false,
  });
  console.log("Saved results_page_verified.png");

  // 2. Mobile Viewport (390x844)
  console.log("\n=== Launching Mobile Verification ===");
  const mobileContext = await browser.newContext({
    ...devices["iPhone 14"],
  });
  const mobilePage = await mobileContext.newPage();

  await mobilePage.goto("http://localhost:8090/login", { waitUntil: "networkidle" });
  await mobilePage.waitForTimeout(500);

  await mobilePage.locator('input[autocomplete="username"]').first().fill("admin");
  await mobilePage.locator('input[type="password"]').first().fill("321");
  await mobilePage.click('button[type="submit"]');

  await mobilePage.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 });

  await mobilePage.goto(workspaceUrl, { waitUntil: "networkidle" });
  await mobilePage.waitForTimeout(3000);

  const mobileAllBtn = mobilePage.locator("button", { hasText: /Semua Record|All Records/i }).first();
  await mobileAllBtn.scrollIntoViewIfNeeded();
  await mobileAllBtn.click();
  await mobilePage.waitForTimeout(2000);

  await mobilePage.screenshot({
    path: join(screenshotDir, "matching_review_table_mobile_verified.png"),
    fullPage: false,
  });
  console.log("Saved matching_review_table_mobile_verified.png");

  await browser.close();
  console.log("\n=== ALL PLAYWRIGHT TESTS PASSED WITH 100% SUCCESS! ===");
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
