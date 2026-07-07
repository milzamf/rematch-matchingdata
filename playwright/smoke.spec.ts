import { expect, test } from "@playwright/test";

const demoSession = {
  id: "u_demo",
  username: "demo",
  fullName: "Andi Setiawan",
  email: "andi@demo.id",
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((session) => {
    window.localStorage.setItem("batchmatch:session", JSON.stringify(session));
  }, demoSession);
});

test("main BatchMatch pages load", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Matching", exact: true }).click();
  await expect(page).toHaveURL(/\/matching$/);
  await expect(page.getByRole("link", { name: "Matching", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /upload/i })).toBeVisible();
  await expect(page.getByText("Step 1 of 8")).toBeVisible();

  await page.getByRole("link", { name: "Results", exact: true }).click();
  await expect(page).toHaveURL(/\/results$/);
  await expect(page.getByRole("link", { name: "Results", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
});
