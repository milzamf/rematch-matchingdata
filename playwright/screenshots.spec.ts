import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

const screenshotDir = join(process.cwd(), "review", "screenshots");

const demoSession = {
  id: "u_demo",
  username: "demo",
  fullName: "Andi Setiawan",
  email: "andi@demo.id",
};

const preferences = {
  theme: "light",
  language: "en",
};

const pages = [
  {
    name: "dashboard",
    path: "/",
    ready: async (page) => {
      await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
    },
  },
  {
    name: "matching",
    path: "/matching",
    ready: async (page) => {
      await expect(page.getByRole("link", { name: "Matching", exact: true })).toBeVisible();
      await expect(page.getByText("Step 1 of 8")).toBeVisible();
    },
  },
  {
    name: "results",
    path: "/results",
    ready: async (page) => {
      await expect(page.getByRole("link", { name: "Results", exact: true })).toBeVisible();
    },
  },
  {
    name: "settings",
    path: "/settings",
    ready: async (page) => {
      await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
    },
  },
] as const;

test.beforeAll(() => {
  mkdirSync(screenshotDir, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(
    ({ session, prefs }) => {
      window.localStorage.setItem("batchmatch:session", JSON.stringify(session));
      window.localStorage.setItem("batchmatch:preferences", JSON.stringify(prefs));
    },
    { session: demoSession, prefs: preferences },
  );
});

for (const item of pages) {
  test(`captures ${item.name} screenshot`, async ({ page }) => {
    await page.goto(item.path);
    await item.ready(page);
    await page.screenshot({
      path: join(screenshotDir, `${item.name}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}
