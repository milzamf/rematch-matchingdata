import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync("review/shared-e2e.json", "utf8"));
const path = `/matching?workspace=${fixture.workspace}`;
async function login(page: Page, actor: string) {
  const boot = page.waitForResponse((r) => r.url().endsWith("/api/me"), { timeout: 45_000 });
  await page.goto("/login");
  await boot;
  await page.locator('input[type="text"]').fill(`e2e-${actor}`);
  await page.locator('input[type="password"]').fill("e2e-test-password");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/login") && r.request().method() === "POST",
  );
  await page.locator('button[type="submit"]').click();
  expect((await response).status()).toBe(200);
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto(path);
}
async function choose(page: Page, label: string, option: string) {
  await page.locator(`button[role="combobox"][aria-label="${label}"]`).click();
  await page.getByRole("option", { name: option, exact: label !== "Kandidat acuan" }).click();
}
async function grant(page: Page, actor: string, role: string) {
  await page.getByRole("button", { name: "Kelola Akses", exact: true }).click();
  await page.getByRole("combobox", { name: "Pengguna terdaftar" }).click();
  await page.getByPlaceholder("Ketik minimal 2 karakter").fill(`E2E ${actor}`);
  await page
    .getByRole("option")
    .filter({ hasText: `e2e-${actor}@isolated.invalid` })
    .click();
  await choose(page, "Role anggota", role);
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/members") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Tambah Anggota", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator('button[role="combobox"][aria-label="Role anggota"]')).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function open(page: Page, key: string) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator(`tr[data-record-key="${key}"]`)
    .getByRole("button", { name: "Buka Review" })
    .click();
  await expect(page.getByRole("region", { name: "Detail review" })).toContainText(`Record ${key}`);
}
async function save(page: Page, decision: string, proposal = false) {
  await page
    .getByRole("button", { name: proposal ? "Ajukan Revisi" : "Review Record", exact: true })
    .click();
  await choose(page, "Keputusan yang diusulkan", decision);
  if (proposal) await page.getByLabel("Alasan revisi").fill("Revisi dari sesi browser nyata");
  const response = page.waitForResponse(
    (r) =>
      /\/jobs\/.*\/(decisions|proposals)$/.test(new URL(r.url()).pathname) &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: proposal ? "Kirim Usulan" : "Simpan Keputusan", exact: true })
    .click();
  return await response;
}
async function state(page: Page, key: string) {
  return await page.evaluate(
    async ({ w, j, key }) => {
      const r = await fetch(
        `/api/stage5a/workspaces/${w}/jobs/${j}/review-results?record_key=${encodeURIComponent(key)}`,
      );
      const data = await r.json();
      return { http: r.status, state: data.data?.data[0] };
    },
    { w: fixture.workspace, j: fixture.job, key },
  );
}
test("real sessions: sharing, review, approval, conflicts, Undo, export and revocation", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    Array.from({ length: 6 }, () =>
      browser.newContext({ baseURL: "http://127.0.0.1:5178", acceptDownloads: true }),
    ),
  );
  const [owner, editor, viewer, other, admin, pimpinan] = await Promise.all(
    contexts.map((c) => c.newPage()),
  );
  try {
    await test.step("Owner shares Editor/Viewer from Matching", async () => {
      await login(owner, "owner");
      await expect(owner.getByText(fixture.name, { exact: true })).toBeVisible();
      await grant(owner, "editor", "Editor");
      await grant(owner, "viewer", "Viewer");
      await grant(owner, "other", "Editor");
      await login(editor, "editor");
      await login(viewer, "viewer");
      await login(other, "other");
      await login(admin, "admin");
      await login(pimpinan, "pimpinan");
      await viewer.goto("/workspaces");
      await expect(viewer.getByText(fixture.name, { exact: true })).toBeVisible();
      await viewer.goto(path);
      await open(viewer, "001");
      await expect(viewer.getByRole("button", { name: "Review Record", exact: true })).toHaveCount(
        0,
      );
      await expect(pimpinan.getByRole("button", { name: "Kelola Akses", exact: true })).toHaveCount(
        0,
      );
      await expect(admin.getByRole("button", { name: "Kelola Akses", exact: true })).toBeVisible();
    });
    await test.step("Dataset, rank, sort, filters and committed Accept/Undo/Reject/Unmatched", async () => {
      await editor.getByRole("button", { name: /^Input: E2E input/ }).click();
      await expect(
        editor.getByText("Pratinjau parsial; file sumber tidak tersedia."),
      ).toBeVisible();
      await choose(editor, "Urutkan", "Similarity tertinggi");
      await expect(editor.locator("tr[data-record-key]").first()).toHaveAttribute(
        "data-record-key",
        "001",
      );
      await choose(editor, "Urutkan", "Similarity terendah");
      await expect(editor.locator("tr[data-record-key]").first()).toHaveAttribute(
        "data-record-key",
        "005",
      );
      await choose(editor, "Provinsi input", "JAWA BARAT");
      await expect(editor.locator("tr[data-record-key]")).toHaveCount(6);
      await editor.getByRole("button", { name: "Reset filter" }).click();
      await open(editor, "001");
      expect((await save(editor, "Terima Match")).status()).toBe(200);
      await expect.poll(async () => (await state(editor, "001")).state?.version).toBe(2);
      await expect(editor.getByRole("region", { name: "Detail review" })).toContainText("Versi 2");
      await editor.getByRole("button", { name: "Undo Keputusan" }).click();
      await expect.poll(async () => (await state(editor, "001")).state?.version).toBe(3);
      await expect(editor.getByRole("region", { name: "Detail review" })).toContainText("Versi 3");
      expect((await save(editor, "Tolak Kandidat")).status()).toBe(200);
      await expect
        .poll(async () => (await state(editor, "001")).state?.decision)
        .toBe("reject_match");
      expect((await state(editor, "001")).state.status).toBe("possible_match");
      expect((await save(editor, "Tandai Unmatched")).status()).toBe(200);
      await expect.poll(async () => (await state(editor, "001")).state?.status).toBe("unmatched");
      await editor.getByRole("button", { name: "Review Record", exact: true }).click();
      await choose(editor, "Keputusan yang diusulkan", "Terima Match");
      await choose(editor, "Kandidat acuan", "#2 ref-alternative (63%)");
      const alternative = editor.waitForResponse((r) => r.url().endsWith("/decisions"));
      await editor.getByRole("button", { name: "Simpan Keputusan", exact: true }).click();
      expect((await alternative).status()).toBe(200);
      await expect.poll(async () => (await state(editor, "001")).state?.similarity_score).toBe(63);
      await editor.getByRole("button", { name: "Undo Keputusan" }).click();
      await expect.poll(async () => (await state(editor, "001")).state?.status).toBe("unmatched");
      await open(editor, "1");
      expect((await state(editor, "1")).state.version).toBe(1);
      await editor.getByRole("button", { name: "Review Record", exact: true }).click();
      await choose(editor, "Keputusan yang diusulkan", "Tandai Unmatched");
      await editor.keyboard.press("Escape");
      await editor.goto(`/results?workspace=${fixture.workspace}`);
      await expect(editor.locator('tr[data-record-key="001"]')).toContainText("unmatched");
      const download = editor.waitForEvent("download");
      await editor.getByRole("button", { name: "Ekspor hasil CSV" }).click();
      const d = await download;
      const stream = await d.createReadStream();
      const chunks = [];
      for await (const b of stream!) chunks.push(b);
      const csv = Buffer.concat(chunks).toString();
      expect(csv).toContain("001,unmatched,mark_unmatched");
    });
    await test.step("Proposal approved by Owner, then rejected by Admin; author kept", async () => {
      await editor.goto(path);
      await open(editor, "002");
      expect((await save(editor, "Tandai Unmatched", true)).status()).toBe(200);
      await owner.getByRole("button", { name: "Muat Data Terbaru", exact: true }).click();
      await owner.getByRole("button", { name: "Setujui", exact: true }).click();
      await owner.getByRole("button", { name: "Konfirmasi", exact: true }).click();
      await expect.poll(async () => (await state(owner, "002")).state?.version).toBe(2);
      const approved = (await state(owner, "002")).state;
      expect(approved.actors.reviewer.id).toBe(fixture.actors.editor);
      expect(approved.actors.approver.id).toBe(fixture.actors.owner);
      expect(approved.decision_protection).toBe("approved");
      await editor.getByRole("button", { name: "Muat Data Terbaru", exact: true }).click();
      expect((await save(editor, "Terima Match", true)).status()).toBe(200);
      await admin.getByRole("button", { name: "Muat Data Terbaru", exact: true }).click();
      await admin.getByRole("button", { name: "Tolak", exact: true }).click();
      await admin.getByLabel("Alasan penyelesaian").fill("Pertahankan keputusan");
      await admin.getByRole("button", { name: "Konfirmasi", exact: true }).click();
      expect((await state(admin, "002")).state.version).toBe(2);
    });
    await test.step("Two users with stale dialogs: one state and one reference claim", async () => {
      await open(editor, "003");
      await open(other, "003");
      await editor.getByRole("button", { name: "Review Record", exact: true }).click();
      await other.getByRole("button", { name: "Review Record", exact: true }).click();
      expect((await state(editor, "003")).http).toBe(200);
      const first = editor.waitForResponse((r) => r.url().endsWith("/decisions"));
      const stale = other.waitForResponse((r) => r.url().endsWith("/decisions"));
      await Promise.all([
        editor.getByRole("button", { name: "Simpan Keputusan", exact: true }).click(),
        other.getByRole("button", { name: "Simpan Keputusan", exact: true }).click(),
      ]);
      const responses = await Promise.all([first, stale]);
      expect(responses.map((r) => r.status()).sort()).toEqual([200, 409]);
      await expect(
        (responses[0].status() === 409 ? editor : other).getByRole("alert").first(),
      ).toBeVisible();
      await Promise.all([editor.keyboard.press("Escape"), other.keyboard.press("Escape")]);
      await open(editor, "004");
      await open(other, "005");
      await editor.getByRole("button", { name: "Review Record", exact: true }).click();
      await other.getByRole("button", { name: "Review Record", exact: true }).click();
      const claimed = editor.waitForResponse((r) => r.url().endsWith("/decisions"));
      const conflict = other.waitForResponse((r) => r.url().endsWith("/decisions"));
      await Promise.all([
        editor.getByRole("button", { name: "Simpan Keputusan", exact: true }).click(),
        other.getByRole("button", { name: "Simpan Keputusan", exact: true }).click(),
      ]);
      expect((await Promise.all([claimed, conflict])).map((r) => r.status()).sort()).toEqual([
        200, 409,
      ]);
      const states = await Promise.all([state(editor, "004"), state(editor, "005")]);
      expect(states.map((r) => r.state.status).sort()).toEqual(["matched", "possible_match"]);
    });
    await test.step("Revocation fences reader and UI; session stays valid", async () => {
      const members = await owner.evaluate(
        async (w) => (await fetch(`/api/stage5a/workspaces/${w}/members`)).json(),
        fixture.workspace,
      );
      const m = members.data.data.find(
        (r: { user_id: number }) => r.user_id === fixture.actors.viewer,
      );
      const response = await owner.evaluate(
        async ({ w, u, version }) =>
          fetch(`/api/stage5a/workspaces/${w}/members/${u}`, {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              "X-XSRF-TOKEN": decodeURIComponent(
                document.cookie
                  .split("; ")
                  .find((c) => c.startsWith("XSRF-TOKEN="))!
                  .split("=")
                  .slice(1)
                  .join("="),
              ),
            },
            body: JSON.stringify({ expected_version: version }),
          }).then((r) => r.status),
        { w: fixture.workspace, u: fixture.actors.viewer, version: m.version },
      );
      expect(response).toBe(200);
      await expect(viewer.locator("tr[data-record-key]")).toHaveCount(0);
      expect((await state(viewer, "001")).http).toBe(403);
      expect(await viewer.evaluate(async () => (await fetch("/api/me")).status)).toBe(200);
    });
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("Admin manages shared access from actual Administration page", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:5178" });
  const page = await context.newPage();
  try {
    await login(page, "admin");
    await page.goto("/admin");
    const row = page.locator("tr").filter({ hasText: fixture.workspace });
    await row.getByRole("button", { name: "Kelola Akses", exact: true }).click();
    await page.locator('button[role="combobox"][aria-label="Pengguna terdaftar"]').click();
    await page.getByPlaceholder("Ketik minimal 2 karakter").fill("E2E viewer");
    await page.getByRole("option").filter({ hasText: "e2e-viewer@isolated.invalid" }).click();
    await choose(page, "Role anggota", "Viewer");
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/members") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /^(Tambah Anggota|Simpan Role Anggota)$/ }).click();
    expect((await response).status()).toBe(200);
    const members = await page.evaluate(
      async (w) => (await fetch(`/api/stage5a/workspaces/${w}/members`)).json(),
      fixture.workspace,
    );
    expect(
      members.data.data.find((m: { user_id: number }) => m.user_id === fixture.actors.viewer),
    ).toMatchObject({ role: "viewer", status: "active" });
  } finally {
    await context.close();
  }
});

test("Current metadata enables only prepared input-region filters", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:5178" });
  const page = await context.newPage();
  try {
    await login(page, "editor");
    const meta = await page.evaluate(
      async (w) => (await fetch(`/api/stage5a/workspaces/${w}`)).json(),
      fixture.workspace,
    );
    expect(meta.data.job.region_filters_ready).toBe(true);
    await expect(
      page.locator('button[role="combobox"][aria-label="Provinsi input"]'),
    ).toBeEnabled();
    await choose(page, "Provinsi input", "JAWA BARAT");
    await expect(page.locator("tr[data-record-key]")).toHaveCount(6);
    await page.getByLabel("Similarity minimum").fill("98");
    await page.getByLabel("Similarity maximum").fill("100");
    await page.getByRole("button", { name: "Terapkan", exact: true }).click();
    await expect(page.locator("tr[data-record-key]")).toHaveCount(2);
  } finally {
    await context.close();
  }
});

test("Sharing flags prevent a legacy review endpoint bypass", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:5178" });
  const page = await context.newPage();
  try {
    await login(page, "admin");
    const before = await state(page, "001");
    const result = await page.evaluate(async (job) => {
      const csrf = decodeURIComponent(
        document.cookie
          .split("; ")
          .find((c) => c.startsWith("XSRF-TOKEN="))!
          .split("=")
          .slice(1)
          .join("="),
      );
      const r = await fetch(`/api/matching-jobs/${job}/review-decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": csrf },
        body: JSON.stringify({ input_record_key: "001", decision: "mark_unmatched" }),
      });
      return { http: r.status, body: await r.json() };
    }, fixture.job);
    expect(result).toMatchObject({ http: 409, body: { code: "legacy_review_write_disabled" } });
    expect((await state(page, "001")).state).toEqual(before.state);
  } finally {
    await context.close();
  }
});
