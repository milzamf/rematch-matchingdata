import { expect, test, type Page } from "@playwright/test";

const workspace = {
  id: "w1",
  name: "Workspace Bersama",
  user_id: 1,
  status: "review",
  matching_job_id: "j1",
  configuration_version: 1,
};
const proposal = {
  id: "p1",
  matching_job_id: "j1",
  input_record_key: "001",
  expected_version: 3,
  version: 1,
  current_state_version: 3,
  before_decision: "accept_match",
  before_status: "matched",
  before_reference_record_key: "1",
  proposed_reference_record_key: null,
  proposed_decision: "mark_unmatched",
  reason: "Perlu koreksi acuan",
  status: "pending",
  previous_reviewer_name: "Owner",
  proposer_name: "Editor",
  approver_name: null,
  proposed_by_user_id: 2,
  previous_reviewer_user_id: 1,
  resolution_reason: null,
  created_at: "2026-10-13 10:00:00",
};
const permissions = [
  "dashboard.view",
  "workspace.view",
  "matching.view",
  "review.view",
  "review.decide",
  "admin.access",
];
type Role = "owner" | "admin" | "editor" | "viewer" | "pimpinan";
async function mock(page: Page, role: Role = "owner") {
  const state = {
    revoked: false,
    conflict: "",
    writes: [] as { path: string; body: Record<string, unknown> }[],
    unexpected: [] as string[],
    members: [
      {
        id: "m1",
        user_id: 2,
        name: "Editor",
        email: "editor@local.test",
        role: "editor",
        status: "active",
        version: 1,
      },
    ],
    proposals: [{ ...proposal }],
  };
  const actor = role === "owner" ? 1 : role === "admin" ? 9 : 2;
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const send = (data: unknown, status = 200) =>
      route.fulfill({ status, json: { success: status < 400, data } });
    const fail = (code: string, status = 409) =>
      route.fulfill({ status, json: { success: false, code, details: {} } });
    const paged = (data: unknown[]) => ({
      data,
      total: data.length,
      current_page: 1,
      last_page: 1,
      per_page: 50,
    });
    if (path === "/api/me")
      return send({
        user: {
          id: actor,
          name: role === "owner" ? "Owner" : role,
          email: `${role}@local.test`,
          role: role === "admin" ? "admin" : role === "pimpinan" ? "pimpinan" : "user",
        },
        permissions,
      });
    if (path === "/api/admin/users")
      return send([
        {
          id: 1,
          name: "Owner",
          email: "owner@local.test",
          role: "user",
          workspace_count: 1,
          dataset_count: 2,
          matching_job_count: 1,
        },
      ]);
    if (path === "/api/admin/workspaces")
      return send([
        {
          ...workspace,
          current_step: 3,
          record_count: 100,
          updated_at: "2026-10-13",
          owner: { id: 1, name: "Owner", email: "owner@local.test", role: "user" },
        },
      ]);
    if (!path.startsWith("/api/stage5a/")) {
      state.unexpected.push(`${req.method()} ${path}`);
      return fail("unmocked_api", 503);
    }
    if (path.endsWith("/permissions")) {
      if (state.revoked) return fail("workspace_forbidden", 403);
      const write = ["owner", "admin", "editor"].includes(role);
      const manage = ["owner", "admin"].includes(role);
      return send({
        workspace_id: "w1",
        role,
        membership_version: role === "owner" ? null : 1,
        permissions: {
          read: true,
          review: write,
          propose: write,
          approve: manage,
          members: manage,
          configure: manage,
          run: manage,
          dataset_write: manage,
          export_read: true,
        },
      });
    }
    if (req.method() === "GET") {
      if (path === "/api/stage5a/workspaces") return send(paged([workspace]));
      if (path.endsWith("/members")) return send(paged(state.members));
      if (path.endsWith("/users"))
        return send([{ id: 3, name: "Pengguna Baru", email: "baru@local.test" }]);
      if (path.endsWith("/proposals"))
        return send(
          paged(state.proposals.filter((p) => p.status === url.searchParams.get("status"))),
        );
      state.unexpected.push(path);
      return fail("unmocked_api", 503);
    }
    const body = req.postDataJSON();
    state.writes.push({ path, body });
    if (state.revoked) return fail("workspace_forbidden", 403);
    if (state.conflict && !path.endsWith("/resolve")) return fail(state.conflict);
    if (path.endsWith("/members")) {
      const existing = state.members.find((m) => m.user_id === body.user_id);
      if (existing && body.expected_version !== existing.version)
        return fail("stale_membership_version");
      if (existing) {
        existing.role = body.role;
        existing.status = "active";
        existing.version++;
        return send(existing);
      }
      if (body.expected_version !== 0) return fail("stale_membership_version");
      const m = {
        id: "m2",
        user_id: body.user_id,
        name: "Pengguna Baru",
        email: "baru@local.test",
        role: body.role,
        status: "active",
        version: 1,
      };
      state.members.push(m);
      return send(m);
    }
    if (req.method() === "DELETE" && path.includes("/members/")) {
      const m = state.members.find((m) => m.user_id === Number(path.split("/").at(-1)))!;
      m.status = "revoked";
      m.version++;
      return send(m);
    }
    const ack = {
      operation_id: "op1",
      applied: 0,
      conflicted: 0,
      skipped: 0,
      approval_required: 0,
      items: [] as Record<string, unknown>[],
    };
    if (path.endsWith("/resolve")) {
      if (state.conflict) {
        state.proposals[0].status =
          state.conflict === "stale_review_version" ? "stale" : "conflicted";
        state.proposals[0].version++;
        return send(
          {
            ...ack,
            conflicted: 1,
            items: [
              {
                input_record_key: "001",
                request_id: "p1",
                request_version: 2,
                status: state.proposals[0].status,
                conflict_code: state.conflict,
                outcome: "conflicted",
              },
            ],
          },
          409,
        );
      }
      expect(body.expected_request_version).toBe(1);
      expect(body.idempotency_key).toEqual(expect.any(String));
      state.proposals[0].status = body.approve ? "approved" : "rejected";
      return send({
        ...ack,
        applied: body.approve ? 1 : 0,
        rejected: body.approve ? 0 : 1,
        items: [
          {
            input_record_key: "001",
            version: 4,
            request_id: "p1",
            request_version: 2,
            status: state.proposals[0].status,
            outcome: body.approve ? "applied" : "rejected",
          },
        ],
      });
    }
    if (path.endsWith("/proposals"))
      return send({
        ...ack,
        submitted: 1,
        items: [
          {
            input_record_key: body.input_record_key,
            request_id: "p1",
            request_version: 1,
            version: 3,
            status: "pending",
            outcome: "submitted",
          },
        ],
      });
    if (path.endsWith("/decisions") || path.endsWith("/undo"))
      return send({
        ...ack,
        applied: 1,
        items: [{ input_record_key: "001", version: 4, decision_id: "d1", outcome: "applied" }],
      });
    state.unexpected.push(path);
    return fail("unmocked_api", 503);
  });
  await page.route("**/sanctum/**", (route) => route.fulfill({ status: 204 }));
  return state;
}
async function open(page: Page, role: Role = "owner") {
  const state = await mock(page, role);
  await page.goto("/matching?workspace=w1");
  await expect(page.getByRole("heading", { name: "Workspace Bersama" })).toBeVisible();
  return state;
}
async function choose(page: Page, name: string, option: string) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
test("Owner opens sharing and changes/revokes a versioned member", async ({ page }) => {
  const state = await open(page);
  await page.getByRole("button", { name: "Kelola Akses", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Pemilik: Owner", { exact: false }),
  ).toBeVisible();
  await choose(page, "Role Editor", "Viewer");
  await expect(page.getByText("Role anggota diperbarui", { exact: true })).toBeVisible();
  expect(state.writes[0].body).toEqual({ user_id: 2, role: "viewer", expected_version: 1 });
  await page.getByRole("button", { name: "Cabut Akses", exact: true }).click();
  await page.getByRole("button", { name: "Ya, Cabut Akses" }).click();
  await expect(page.getByText("Akses dicabut", { exact: true })).toBeVisible();
  expect(state.writes[1].body).toEqual({ expected_version: 2 });
  expect(state.unexpected).toEqual([]);
});
for (const role of ["Editor", "Viewer"])
  test(`Owner adds ${role} using searchable registered users`, async ({ page }) => {
    const state = await open(page);
    await page.getByRole("button", { name: "Kelola Akses", exact: true }).click();
    await page.getByRole("combobox", { name: "Pengguna terdaftar" }).click();
    await page.getByPlaceholder("Ketik minimal 2 karakter").fill("Baru");
    await page.getByRole("option", { name: "Pengguna Baru baru@local.test" }).click();
    if (role === "Viewer") await choose(page, "Role anggota", "Viewer");
    await page.getByRole("button", { name: "Tambah Anggota", exact: true }).click();
    await expect(page.getByText("Akses anggota disimpan", { exact: true })).toBeVisible();
    expect(state.writes[0].body).toEqual({
      user_id: 3,
      role: role.toLowerCase(),
      expected_version: 0,
    });
    expect(state.unexpected).toEqual([]);
  });
for (const role of ["editor", "viewer", "pimpinan"] as Role[])
  test(`${role} sees only permitted actions`, async ({ page }) => {
    const state = await open(page, role);
    await expect(page.getByRole("button", { name: "Kelola Akses" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Menunggu Persetujuan" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ajukan Revisi", exact: true })).toHaveCount(
      role === "editor" ? 1 : 0,
    );
    await expect(page.getByRole("button", { name: "Review Record" })).toHaveCount(0);
    expect(state.writes).toEqual([]);
  });
test("Editor proposes without changing effective decision, preserves key 001", async ({ page }) => {
  const state = await open(page, "editor");
  await page.getByRole("button", { name: "Ajukan Revisi", exact: true }).click();
  await choose(page, "Keputusan yang diusulkan", "Tandai Unmatched");
  await expect(page.getByRole("button", { name: "Kirim Usulan" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Alasan revisi" }).fill("Periksa ulang wilayah");
  await page.getByRole("button", { name: "Kirim Usulan" }).click();
  await expect(
    page.getByText("Menunggu persetujuan. Keputusan efektif belum berubah."),
  ).toBeVisible();
  await expect(page.getByText("Keputusan efektif: Terima Match")).toBeVisible();
  expect(state.writes[0].body).toMatchObject({
    input_record_key: "001",
    expected_version: 3,
    decision: "mark_unmatched",
    reason: "Periksa ulang wilayah",
  });
  expect(state.writes[0].body).not.toHaveProperty("candidate_id");
  expect(state.unexpected).toEqual([]);
});

test("Owner decision and Undo use acknowledged versions and operation ID", async ({ page }) => {
  const state = await open(page);
  await page.getByRole("button", { name: "Review Record" }).click();
  await page.getByRole("button", { name: "Simpan Keputusan" }).click();
  await page.getByRole("button", { name: "Undo Keputusan" }).click();
  await expect(page.getByText("Keputusan dibatalkan", { exact: true })).toBeVisible();
  expect(state.writes[0].body).toMatchObject({
    items: [
      {
        input_record_key: "001",
        expected_version: 3,
        decision: "accept_match",
        candidate_id: "01a1237b-9ba0-72b3-9063-8a47736f4863",
      },
    ],
  });
  expect(state.writes[1].body).toMatchObject({
    operation_id: "op1",
    items: [{ input_record_key: "001", expected_version: 4 }],
  });
});
for (const approve of [true, false])
  test(`Owner ${approve ? "approves" : "rejects"} revision through backend contract`, async ({
    page,
  }) => {
    const state = await open(page);
    await page.getByRole("button", { name: approve ? "Setujui" : "Tolak", exact: true }).click();
    if (!approve) {
      await expect(page.getByRole("button", { name: "Konfirmasi" })).toBeDisabled();
      await page.getByRole("textbox", { name: "Alasan penyelesaian" }).fill("Bukti belum cukup");
    }
    await page.getByRole("button", { name: "Konfirmasi" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(state.writes[0].body).toMatchObject({ approve, expected_request_version: 1 });
    expect(state.unexpected).toEqual([]);
    await choose(page, "Status usulan", approve ? "Disetujui" : "Ditolak");
    await expect(page.getByText("Alasan: Perlu koreksi acuan")).toBeVisible();
  });
test("Durable stale approval 409 updates status without replay", async ({ page }) => {
  const state = await open(page);
  state.conflict = "stale_review_version";
  await page.getByRole("button", { name: "Setujui", exact: true }).click();
  await page.getByRole("button", { name: "Konfirmasi" }).click();
  await expect(
    page.getByText("Record telah diubah pengguna lain.", { exact: false }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(1);
  await choose(page, "Status usulan", "Kedaluwarsa");
  await expect(page.getByText("Alasan: Perlu koreksi acuan")).toBeVisible();
  expect(state.writes).toHaveLength(1);
});
for (const code of ["reference_conflict", "input_integrity_hold"])
  test(`Decision handles ${code} without auto retry`, async ({ page }) => {
    const state = await open(page);
    state.conflict = code;
    await page.getByRole("button", { name: "Review Record" }).click();
    await page.getByRole("button", { name: "Simpan Keputusan" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Simpan Keputusan" })).toBeDisabled();
    expect(state.writes).toHaveLength(1);
  });
test("Access revocation removes write actions", async ({ page }) => {
  const state = await open(page, "editor");
  state.revoked = true;
  await page.getByRole("button", { name: "Ajukan Revisi", exact: true }).click();
  await page.getByRole("textbox", { name: "Alasan revisi" }).fill("Cek data");
  await page.getByRole("button", { name: "Kirim Usulan" }).click();
  await expect(
    page.getByText("Hak akses workspace berubah atau dicabut.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajukan Revisi", exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});
test("Admin management reuses dialog and opens shared workspace", async ({ page }) => {
  const state = await mock(page, "admin");
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "Kelola Akses", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Buka", exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "Workspace Bersama" })).toBeVisible();
  expect(state.unexpected).toEqual([]);
});
test("Shared list and responsive dialogs keep keyboard focus", async ({ page }) => {
  const state = await mock(page, "editor");
  await page.goto("/workspaces");
  await expect(page.getByText("Dibagikan · Akses: editor")).toBeVisible();
  await page.getByRole("link", { name: "Buka Workspace" }).click();
  await expect(page.getByRole("heading", { name: "Workspace Bersama" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Ajukan Revisi", exact: true }).click();
  const box = await page.getByRole("dialog").boundingBox();
  expect(box!.width).toBeLessThan(390);
  await page.screenshot({
    path: "review/screenshots/stage5b-approval-mobile.png",
    animations: "disabled",
  });
  await page.getByRole("combobox", { name: "Keputusan yang diusulkan" }).click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Ajukan Revisi", exact: true })).toBeFocused();
  expect(state.unexpected).toEqual([]);
});

test("Sharing modal fits mobile and restores trigger focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole("button", { name: "Kelola Akses", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Role Editor" })).toBeVisible();
  const box = await page.getByRole("dialog").boundingBox();
  expect(box!.width).toBeLessThan(390);
  await page.screenshot({
    path: "review/screenshots/stage5b-sharing-mobile.png",
    animations: "disabled",
  });
  await page.getByRole("combobox", { name: "Role anggota", exact: true }).click();
  await page.screenshot({
    path: "review/screenshots/stage5b-select-mobile.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Kelola Akses", exact: true })).toBeFocused();
});
