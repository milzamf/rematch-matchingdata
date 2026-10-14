import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("real flag-off session keeps legacy reader, decision and Undo", async ({ page }) => {
  const f = JSON.parse(readFileSync("review/shared-legacy.json", "utf8"));
  const boot = page.waitForResponse((r) => r.url().endsWith("/api/me"), { timeout: 15_000 });
  await page.goto("/login");
  await boot;
  await expect(page.locator('input[type="text"]')).toBeEnabled();
  await expect(page.locator('button[type="submit"]')).toBeEnabled();
  await page.locator('input[type="text"]').fill("e2e-admin");
  await page.locator('input[type="password"]').fill("e2e-test-password");
  const login = page.waitForResponse(
    (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  await page.locator('button[type="submit"]').click();
  expect((await login).status()).toBe(200);
  await page.goto("/workspaces");
  await expect(page.getByText(f.name, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kelola Akses", exact: true })).toHaveCount(0);
  const result = await page.evaluate(async (f) => {
    const csrf = decodeURIComponent(
      document.cookie
        .split("; ")
        .find((c) => c.startsWith("XSRF-TOKEN="))!
        .split("=")
        .slice(1)
        .join("="),
    );
    const headers = { "Content-Type": "application/json", "X-XSRF-TOKEN": csrf };
    const url = `/api/matching-jobs/${f.job}`;
    const read = () =>
      fetch(`${url}/review-results?include_groups=false&include_column_quality=false`).then((r) =>
        r.json(),
      );
    const before = await read();
    const saved = await fetch(`${url}/review-decisions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ input_record_key: "001", decision: "mark_unmatched" }),
    });
    const ack = await saved.json();
    const after = await read();
    const undo = await fetch(`${url}/review-decisions/${ack.data.decision.id}/undo`, {
      method: "POST",
      headers,
    });
    const undoAck = await undo.json();
    const restored = await read();
    const disabled = await fetch(`/api/stage5a/workspaces/${f.workspace}`);
    return {
      saved: saved.status,
      undo: undo.status,
      undone: undoAck.data.undone_decision_id === ack.data.decision.id,
      before: before.data.summary,
      after: after.data.summary,
      restored: restored.data.summary,
      disabled: disabled.status,
    };
  }, f);
  expect(result.saved).toBe(200);
  expect(result.undo).toBe(200);
  expect(result.undone).toBe(true);
  expect(result.after.unmatched).toBe(result.before.unmatched + 1);
  expect(result.restored).toEqual(result.before);
  expect(result.disabled).toBe(503);
  await page.reload();
  await expect(page.getByText(f.name, { exact: true })).toBeVisible();
});
