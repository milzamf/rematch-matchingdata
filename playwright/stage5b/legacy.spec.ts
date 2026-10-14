import { expect, test } from "@playwright/test";

test("Flag off keeps legacy navigation, filters and decision routes", async ({ page }) => {
  const source = (role: string) => ({
    dataset: {
      id: role,
      dataset_role: role,
      name: role,
      original_filename: `${role}.csv`,
      file_format: "csv",
      file_size: 100,
      selected_sheet: null,
      sheet_names: [],
      delimiter: ",",
      header_row: 1,
      row_count: 1,
      column_count: 1,
      parse_status: "completed",
    },
    columns: [
      {
        id: `${role}-name`,
        name: "nama",
        normalized_name: "nama",
        data_type: "text",
        position: 0,
        null_count: 0,
        null_percentage: 0,
        unique_count: 1,
        duplicate_percentage: 0,
        sample_values: ["Perusahaan Input"],
      },
    ],
    preview_rows: [{ nama: "Perusahaan Input" }],
    profiling_summary: {
      columns: 1,
      rows: 1,
      high_missing_columns: [],
      duplicate_prone_columns: [],
    },
  });
  const candidate = {
    reference_record_key: "1",
    reference_record: { nama: "Perusahaan Acuan" },
    result_type: "possible_match",
    review_status: "pending",
    score: 95,
    rank: 1,
    field_scores: [],
    decision_reason: null,
  };
  const item = {
    input_record_key: "001",
    status: "possible_match",
    display_status: "need_review",
    latest_decision: null,
    input_record: { nama: "Perusahaan Input" },
    candidates: [candidate],
  };
  const review = {
    job: { id: "j1", name: "Fixture", status: "completed" },
    summary: { matched: 0, possible_match: 1, unmatched: 0, reviewed: 0 },
    items: [item],
    case_groups: [],
    system_presets: [],
    custom_rules: [],
    dynamic_patterns: [],
    field_quality_summary: {},
    pagination: { current_page: 1, per_page: 25, total_items: 1, total_pages: 1, from: 1, to: 1 },
  };
  const workspace = {
    id: "w1",
    name: "Legacy Fixture",
    status: "review",
    current_step: 3,
    reference_dataset_id: "reference",
    input_dataset_id: "input",
    matching_job_id: "j1",
    record_count: 1,
    owner: { id: 1, name: "Owner", email: "owner@local.test", role: "user" },
    workflow_state: {
      columnMappings: [
        {
          id: "map1",
          referenceColumnId: "reference-name",
          inputColumnId: "input-name",
          referenceColumnName: "nama",
          inputColumnName: "nama",
          isActive: true,
        },
      ],
      matchingConfiguration: null,
    },
    sync_state: null,
    export_history: [],
    reference_dataset: source("reference"),
    input_dataset: source("input"),
    matching_job: {
      id: "j1",
      name: "Fixture",
      status: "completed",
      processed_count: 1,
      total_count: 1,
      record_counts: { possible_match: 1 },
      started_at: null,
      finished_at: null,
      error_message: null,
    },
    created_at: "2026-10-13",
    updated_at: "2026-10-13",
  };
  const calls: { path: string; method: string; search: string }[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    calls.push({ path, method: req.method(), search: url.search });
    const send = (data: unknown) => route.fulfill({ json: { success: true, data } });
    if (path === "/api/me")
      return send({
        user: { id: 1, name: "Owner", email: "owner@local.test", role: "user" },
        permissions: ["workspace.view", "matching.view", "review.view", "review.decide"],
      });
    if (path === "/api/workspaces") return send([workspace]);
    if (path === "/api/workspaces/w1") return send(workspace);
    if (path.endsWith("/review-region-options"))
      return send({ status: "ready", provinces: [], regencies: [] });
    if (path.endsWith("/review-results")) return send(review);
    if (path.endsWith("/review-decisions") && req.method() === "POST") {
      review.summary = { matched: 1, possible_match: 0, unmatched: 0, reviewed: 1 };
      review.items = [];
      return send({
        decision: {
          id: "d1",
          decision: "accept_match",
          input_record_key: "001",
          selected_reference_record_key: "1",
          new_result_type: "matched",
          affected_records: 1,
        },
        review,
      });
    }
    if (path.endsWith("/review-decisions/d1/undo"))
      return send({
        decision: {
          id: "d1",
          decision: "accept_match",
          input_record_key: "001",
          selected_reference_record_key: "1",
          new_result_type: "possible_match",
          affected_records: 1,
        },
        review: { ...review, items: [item] },
      });
    return route.fulfill({
      status: 503,
      json: { success: false, message: "Unmocked fixture API" },
    });
  });
  await page.goto("/workspaces");
  await page.getByRole("link", { name: /Lanjutkan|Continue/ }).click();
  await expect(page.getByText("Legacy Fixture", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review Hasil" })).toBeVisible();
  await page.getByRole("button", { name: "Semua Record", exact: true }).click();
  await page.getByRole("combobox", { name: "Urutkan", exact: true }).click();
  await page.getByRole("option", { name: "Similarity tertinggi", exact: true }).click();
  await expect
    .poll(() =>
      calls.some(
        (c) => c.path.endsWith("/review-results") && c.search.includes("sort=similarity_desc"),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Terima Match", exact: true }).click();
  await expect
    .poll(() => calls.some((c) => c.path.endsWith("/review-decisions") && c.method === "POST"))
    .toBe(true);
  expect(calls.some((c) => c.path.startsWith("/api/stage5a"))).toBe(false);
});
