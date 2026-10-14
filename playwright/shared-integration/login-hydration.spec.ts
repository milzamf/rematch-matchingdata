import { expect, test } from "@playwright/test";

test("flag-off login waits for bootstrap and submits once without losing fields", async ({
  page,
}) => {
  let finishBootstrap!: () => void;
  const bootstrap = new Promise<void>((resolve) => {
    finishBootstrap = resolve;
  });
  await page.route("**/api/me", async (route) => {
    await bootstrap;
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unauthenticated" }),
    });
  });
  await page.route("**/sanctum/csrf-cookie", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/login", (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ message: "Email or password is incorrect" }),
    }),
  );
  await page.goto("/login");
  const user = page.locator('input[type="text"]');
  const password = page.locator('input[type="password"]');
  const submit = page.getByRole("button", { name: "Masuk", exact: true });
  await expect(user).toBeDisabled();
  await expect(password).toBeDisabled();
  await expect(submit).toBeDisabled();
  finishBootstrap();
  await expect(user).toBeEnabled();
  await user.fill("uat-admin");
  await password.fill("uat-test-only");
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/login") && r.method() === "POST",
  );
  await submit.click();
  expect((await request).postDataJSON()).toEqual({ email: "uat-admin", password: "uat-test-only" });
  await expect(submit).toBeEnabled();
  await expect(user).toHaveValue("uat-admin");
  await expect(password).toHaveValue("uat-test-only");
  await expect(page).toHaveURL(/\/login$/);
});
