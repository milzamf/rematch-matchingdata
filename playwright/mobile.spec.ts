import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const screenshotDir = "C:/Users/ilzam/.gemini/antigravity/brain/1be75c54-9b8f-4858-9e54-807b04b261cb";

const demoSession = {
  id: "u_demo",
  username: "demo",
  fullName: "Andi Setiawan",
  email: "andi@demo.id",
};

const preferences = {
  theme: "light",
  language: "id",
};

test.beforeAll(() => {
  mkdirSync(screenshotDir, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(
    ({ session, prefs }) => {
      window.localStorage.setItem("batchmatch:session", JSON.stringify(session));
      window.localStorage.setItem("batchmatch:preferences", JSON.stringify(prefs));
    },
    { session: demoSession, prefs: preferences },
  );
});

test("mobile dashboard - check layout and overflow", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  const overflow = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const elements: any[] = [];

    document.querySelectorAll("*").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.right > docWidth + 2) {
        elements.push({
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
      elements: elements.slice(0, 15),
    };
  });

  console.log("DASHBOARD_OVERFLOW_REPORT:", JSON.stringify(overflow, null, 2));

  await page.screenshot({
    path: join(screenshotDir, "mobile_dashboard.png"),
    fullPage: true,
  });
});

test("mobile matching - check layout and overflow", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/matching");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  const overflow = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const elements: any[] = [];

    document.querySelectorAll("*").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.right > docWidth + 2) {
        elements.push({
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
      elements: elements.slice(0, 15),
    };
  });

  console.log("MATCHING_OVERFLOW_REPORT:", JSON.stringify(overflow, null, 2));

  await page.screenshot({
    path: join(screenshotDir, "mobile_matching.png"),
    fullPage: true,
  });
});
