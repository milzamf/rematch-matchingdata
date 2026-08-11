import { expect, test, type Page } from "@playwright/test";

const demoSession = {
  id: "u_demo",
  username: "demo",
  fullName: "Andi Setiawan",
  email: "andi@demo.id",
};

type MockColumn = {
  id: string;
  name: string;
  normalized_name: string;
  data_type: "text" | "number" | "date" | "boolean" | "empty" | "unknown";
  position: number;
  null_count: number;
  null_percentage: number;
  unique_count: number;
  duplicate_percentage: number;
  sample_values: string[];
};

const slug = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const mockColumn = (
  datasetRole: "reference" | "input",
  name: string,
  dataType: MockColumn["data_type"],
  position: number,
  overrides: Partial<MockColumn> = {},
): MockColumn => ({
  id: `column-${datasetRole}-${slug(name)}`,
  name,
  normalized_name: slug(name).replace(/-/g, "_"),
  data_type: dataType,
  position,
  null_count: 0,
  null_percentage: 0,
  unique_count: 3,
  duplicate_percentage: 0,
  sample_values: ["A001", "B002"],
  ...overrides,
});

const defaultColumns = (datasetRole: "reference" | "input") => [
  mockColumn(datasetRole, "external_id", "text", 1),
  mockColumn(datasetRole, "full_name", "text", 2, {
    unique_count: 2,
    duplicate_percentage: 33.33,
    sample_values: ["Ayu", "Budi"],
  }),
];

const inspectResponse = (
  datasetRole: "reference" | "input",
  columns = defaultColumns(datasetRole),
) => ({
  success: true,
  data: {
    dataset: {
      id: `dataset-${datasetRole}`,
      dataset_role: datasetRole,
      name: "customers",
      original_filename: "customers.csv",
      file_format: "csv",
      file_size: 128,
      selected_sheet: null,
      sheet_names: [],
      delimiter: ",",
      header_row: 1,
      row_count: 3,
      column_count: columns.length,
      parse_status: "inspected",
    },
    columns,
    preview_rows: [
      Object.fromEntries(columns.map((column) => [column.name, column.sample_values[0] ?? "A001"])),
      Object.fromEntries(columns.map((column) => [column.name, column.sample_values[1] ?? "B002"])),
      Object.fromEntries(columns.map((column) => [column.name, column.sample_values[0] ?? "A001"])),
    ],
    profiling_summary: {
      columns: columns.length,
      rows: 3,
      high_missing_columns: [],
      duplicate_prone_columns: columns
        .filter((column) => column.duplicate_percentage > 0)
        .map((column) => column.name),
    },
  },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript((session) => {
    window.localStorage.setItem("batchmatch:session", JSON.stringify(session));
  }, demoSession);
});

async function uploadDatasetsAndOpenMapping(
  page: Page,
  referenceColumns: MockColumn[],
  inputColumns: MockColumn[],
) {
  let inspectCount = 0;

  await page.route("**/api/datasets/inspect", async (route) => {
    inspectCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        inspectResponse(
          inspectCount === 1 ? "reference" : "input",
          inspectCount === 1 ? referenceColumns : inputColumns,
        ),
      ),
    });
  });

  await page.goto("/matching");
  await page
    .locator('input[type="file"]')
    .nth(0)
    .setInputFiles({
      name: "reference.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("id,name\nA001,Ayu\n"),
    });
  await page
    .locator('input[type="file"]')
    .nth(1)
    .setInputFiles({
      name: "input.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("id,name\nA001,Ayu\n"),
    });

  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByRole("button", { name: /continue/i }).click();
}

test("upload shows loading state and profiling renders successful inspect response", async ({
  page,
}) => {
  let inspectCount = 0;
  await page.route("**/api/datasets/inspect", async (route) => {
    inspectCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(inspectResponse(inspectCount === 1 ? "reference" : "input")),
    });
  });

  await page.goto("/matching");

  await page
    .locator('input[type="file"]')
    .nth(0)
    .setInputFiles({
      name: "reference.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("customer_id,name\nC001,Ayu\n"),
    });
  await expect(page.getByText("Inspecting dataset...")).toBeVisible();
  await expect(page.getByText("3 rows, 2 columns inspected.")).toBeVisible();

  await page
    .locator('input[type="file"]')
    .nth(1)
    .setInputFiles({
      name: "input.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("customer_id,name\nC002,Budi\n"),
    });
  await expect(page.getByText("3 rows, 2 columns inspected.")).toHaveCount(2);

  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page.getByRole("cell", { name: "external_id" }).first()).toBeVisible();
  await expect(page.getByText("Duplicates")).toBeVisible();
  await expect(page.getByText("33.33%").first()).toBeVisible();
});

test("mapping auto-suggests inspected columns with simple name matching rules", async ({
  page,
}) => {
  const referenceColumns = [
    mockColumn("reference", "Nama", "text", 1),
    mockColumn("reference", "NPWP", "text", 2),
    mockColumn("reference", "customer_id", "text", 3),
    mockColumn("reference", "Company Name", "text", 4),
    mockColumn("reference", "Kab/Kota", "text", 5),
    mockColumn("reference", "invoice_date", "date", 6),
    mockColumn("reference", "amount", "number", 7),
    mockColumn("reference", "active", "boolean", 8),
    mockColumn("reference", "unmatched_ref", "text", 9),
  ];
  const inputColumns = [
    mockColumn("input", "Nama", "text", 1),
    mockColumn("input", "npwp", "text", 2),
    mockColumn("input", "customerid", "text", 3),
    mockColumn("input", "company_name", "text", 4),
    mockColumn("input", "Kabupaten Kota", "text", 5),
    mockColumn("input", "invoice_date", "date", 6),
    mockColumn("input", "amount", "number", 7),
    mockColumn("input", "active", "boolean", 8),
  ];

  await uploadDatasetsAndOpenMapping(page, referenceColumns, inputColumns);

  await expect(page.getByText("Auto-suggested mappings")).toBeVisible();
  await expect(page.getByTestId("mapping-row")).toHaveCount(9);
  await expect(page.getByTestId("mapping-input-select").nth(0)).toHaveValue("column-input-nama");
  await expect(page.getByTestId("mapping-input-select").nth(1)).toHaveValue("column-input-npwp");
  await expect(page.getByTestId("mapping-input-select").nth(2)).toHaveValue(
    "column-input-customerid",
  );
  await expect(page.getByTestId("mapping-input-select").nth(3)).toHaveValue(
    "column-input-company-name",
  );
  await expect(page.getByTestId("mapping-input-select").nth(4)).toHaveValue(
    "column-input-kabupaten-kota",
  );
  await expect(page.getByTestId("mapping-input-select").nth(8)).toHaveValue("");
  await expect(page.getByTestId("mapping-algorithm-select")).toHaveCount(0);
  await expect(page.getByTestId("mapping-reference-type").first()).toHaveText("Text");
  await expect(page.getByTestId("mapping-input-type").first()).toHaveText("Text");
  await expect(page.getByTestId("mapping-reference-type").nth(5)).toHaveText("Date");
  await expect(page.getByTestId("mapping-reference-type").nth(6)).toHaveText("Number");
  await expect(page.getByTestId("mapping-reference-type").nth(7)).toHaveText("Boolean");
});

test("mapping supports replace, duplicate validation, remove, and add", async ({ page }) => {
  const referenceColumns = [
    mockColumn("reference", "external_id", "text", 1),
    mockColumn("reference", "city", "text", 2),
    mockColumn("reference", "postal_code", "number", 3),
  ];
  const inputColumns = [
    mockColumn("input", "external_id", "text", 1),
    mockColumn("input", "region", "text", 2),
    mockColumn("input", "postal_code", "number", 3),
  ];

  await uploadDatasetsAndOpenMapping(page, referenceColumns, inputColumns);

  await expect(page.getByTestId("mapping-row")).toHaveCount(3);
  await expect(page.getByTestId("mapping-input-select").nth(1)).toHaveValue("");
  await page.getByTestId("mapping-input-select").nth(1).selectOption("column-input-region");
  await expect(page.getByTestId("mapping-input-select").nth(1)).toHaveValue("column-input-region");

  await expect(
    page
      .getByTestId("mapping-reference-select")
      .nth(1)
      .locator('option[value="column-reference-external-id"]'),
  ).toBeDisabled();

  await expect(page.getByTestId("mapping-algorithm-select")).toHaveCount(0);

  await page.getByTestId("mapping-remove-button").nth(1).click();
  await expect(page.getByTestId("mapping-row")).toHaveCount(2);
  await page.getByTestId("mapping-add-button").click();
  await expect(page.getByTestId("mapping-row")).toHaveCount(3);
  await expect(page.getByTestId("mapping-reference-select").nth(2)).toHaveValue(
    "column-reference-city",
  );
  await expect(page.getByTestId("mapping-input-select").nth(2)).toHaveValue("");
});

test("mapping requires at least one valid pair before continuing", async ({ page }) => {
  const referenceColumns = [
    mockColumn("reference", "reference_only", "text", 1),
    mockColumn("reference", "mystery", "unknown", 2),
  ];
  const inputColumns = [mockColumn("input", "input_only", "text", 1)];

  await uploadDatasetsAndOpenMapping(page, referenceColumns, inputColumns);

  const continueButton = page.getByRole("button", { name: /continue/i });
  await expect(page.getByTestId("mapping-row")).toHaveCount(2);
  await expect(page.getByTestId("mapping-input-select").nth(0)).toHaveValue("");
  await expect(page.getByTestId("mapping-reference-type").nth(1)).toHaveText("Unknown");
  await expect(continueButton).toBeDisabled();

  await page.getByTestId("mapping-input-select").nth(0).selectOption("column-input-input-only");
  await expect(continueButton).toBeEnabled();
});

test("configure uses quick setup, summary, and collapsed advanced settings", async ({ page }) => {
  await uploadDatasetsAndOpenMapping(page, defaultColumns("reference"), defaultColumns("input"));

  await page.getByRole("button", { name: /continue/i }).click();

  await expect(page.getByText("Quick Setup", { exact: true })).toBeVisible();
  await expect(page.getByTestId("config-summary")).toContainText("Balanced");
  await expect(page.getByTestId("config-summary")).toContainText("Managed by preset");
  await expect(page.getByTestId("config-advanced-panel")).toHaveCount(0);

  await page.getByTestId("config-preset-strict").click();
  await expect(page.getByTestId("config-summary")).toContainText("Strict");
  await expect(page.getByTestId("config-summary")).toContainText("Managed by preset");
  await expect(page.getByTestId("config-summary")).toContainText("Identifier Strict");
  await expect(page.getByTestId("config-advanced-panel")).toHaveCount(0);

  await page.getByTestId("config-preset-custom").click();
  const advancedPanel = page.getByTestId("config-advanced-panel");
  await expect(advancedPanel).toBeVisible();
  await expect(advancedPanel.getByText("Strategy", { exact: true })).toBeVisible();
  await expect(advancedPanel.getByText("Algorithm per Field")).toBeVisible();
  await expect(advancedPanel.getByText("Field Weights")).toHaveCount(0);
});

test("configure shows conditional controls for each strategy", async ({ page }) => {
  await uploadDatasetsAndOpenMapping(page, defaultColumns("reference"), defaultColumns("input"));

  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByTestId("config-preset-custom").click();
  const advancedPanel = page.getByTestId("config-advanced-panel");

  await page.getByTestId("config-strategy-exact").click();
  await expect(advancedPanel.getByText("Fields to match")).toBeVisible();
  await expect(advancedPanel.getByText("Similarity Threshold")).toHaveCount(0);
  await expect(advancedPanel.getByText("Candidate Generation")).toHaveCount(0);
  await expect(advancedPanel.getByText("Algorithm per Field")).toHaveCount(0);

  await page.getByTestId("config-strategy-fuzzy").click();
  await expect(advancedPanel.getByText("Algorithm per Field")).toBeVisible();
  await expect(advancedPanel.getByText("Similarity Threshold")).toBeVisible();
  await expect(advancedPanel.getByText("Candidate Generation")).toBeVisible();
  await expect(advancedPanel.getByText("Field Weights")).toHaveCount(0);

  await page.getByTestId("config-candidate-custom").click();
  await page.getByTestId("config-custom-candidate-input").fill("0");
  await expect(page.getByRole("button", { name: /continue/i })).toBeDisabled();
  await page.getByTestId("config-custom-candidate-input").fill("5");
  await expect(page.getByRole("button", { name: /continue/i })).toBeEnabled();

  await page.getByTestId("config-strategy-hybrid").click();
  await expect(advancedPanel.getByRole("button", { name: "Automatic weights" })).toBeVisible();
  await page.getByTestId("config-manual-weights").click();
  await expect(page.getByTestId("config-field-weights")).toBeVisible();

  await page.getByTestId("config-strategy-rule-based").click();
  await expect(advancedPanel.getByText("Rule Builder")).toBeVisible();
  await expect(advancedPanel.getByText("Similarity Threshold")).toHaveCount(0);
});

test("configure saves selected logic into workflow state for run", async ({ page }) => {
  await uploadDatasetsAndOpenMapping(page, defaultColumns("reference"), defaultColumns("input"));

  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByTestId("config-preset-custom").click();
  await page.getByTestId("config-strategy-fuzzy").click();
  await page.getByTestId("config-candidate-custom").click();
  await page.getByTestId("config-custom-candidate-input").fill("5");
  await page.getByRole("button", { name: /continue/i }).click();

  const runSummary = page.getByTestId("run-configuration-summary");
  await expect(runSummary).toContainText("Custom");
  await expect(runSummary).toContainText("Fuzzy Match");
  await expect(runSummary).toContainText("2");
  await expect(runSummary).toContainText("Top 5");
});

test("mapping shows empty state when inspected columns are unavailable", async ({ page }) => {
  await page.goto("/matching");
  await page.getByRole("button", { name: /mapping/i }).click();

  await expect(page.getByText("No columns available yet")).toBeVisible();
  await expect(page.getByText("Upload and inspect both datasets")).toBeVisible();
});

test("upload shows API error response", async ({ page }) => {
  await page.route("**/api/datasets/inspect", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        message: "The file header does not look valid.",
      }),
    });
  });

  await page.goto("/matching");
  await page
    .locator('input[type="file"]')
    .nth(0)
    .setInputFiles({
      name: "bad.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("1,2,3\n4,5,6\n"),
    });

  await expect(page.getByText("The file header does not look valid.").first()).toBeVisible();
});

test("upload validates unsupported file format before API request", async ({ page }) => {
  let apiCalled = false;
  await page.route("**/api/datasets/inspect", async (route) => {
    apiCalled = true;
    await route.abort();
  });

  await page.goto("/matching");
  await page
    .locator('input[type="file"]')
    .nth(0)
    .setInputFiles({
      name: "customers.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"name":"Ayu"}'),
    });

  await expect(page.getByText("Unsupported format. Allowed: .csv, .xlsx").first()).toBeVisible();
  expect(apiCalled).toBe(false);
});
