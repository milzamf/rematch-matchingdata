import { test, expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const fixturePath = "review/shared-uat.json";
async function login(page: Page, username: string) {
  const boot = page.waitForResponse((r) => r.url().endsWith("/api/me"));
  await page.goto("/login");
  await boot;
  await page.locator('input[type="text"]').fill(username);
  await page.locator('input[type="password"]').fill("e2e-test-password");
  const ack = page.waitForResponse((r) => r.url().endsWith("/api/login"));
  await page.locator('button[type="submit"]').click();
  expect((await ack).status()).toBe(200);
  await expect(page).not.toHaveURL(/\/login$/);
}

test("300k reader load after counting optimization", async ({ browser }) => {
  test.setTimeout(300_000);
  const f = JSON.parse(readFileSync(fixturePath, "utf8"));
  const counts = JSON.parse(readFileSync("review/uat-integrity.json", "utf8")).counts;
  const contexts = await Promise.all(
    Array.from({ length: 10 }, () => browser.newContext({ baseURL: "http://127.0.0.1:5178" })),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const endpoint = `/api/stage5a/workspaces/${f.workspace}/jobs/${f.job}`;
  const metrics = [];
  try {
    for (let i = 0; i < pages.length; i++) await login(pages[i], `uat-reviewer-${i}`);
    const totals = await pages[0].evaluate(async (e) => {
      const out = [];
      for (const status of ["", "matched", "possible_match", "unmatched", "duplicate_input"]) {
        const r = await fetch(
          `${e}/review-results?per_page=1${status ? `&status=${status}` : ""}`,
        ).then((r) => r.json());
        out.push({ status, total: r.data.pagination.total });
      }
      return out;
    }, endpoint);
    expect(totals).toEqual([
      { status: "", total: 300000 },
      { status: "matched", total: counts.matched },
      { status: "possible_match", total: counts.possible_match },
      { status: "unmatched", total: counts.unmatched },
      { status: "duplicate_input", total: 1 },
    ]);
    const reviewerCounts = process.env.UAT_REVIEWERS === "10" ? [10] : [1, 5, 10];
    for (const reviewers of reviewerCounts) {
      const batches = await Promise.all(
        pages.slice(0, reviewers).map((page) =>
          page.evaluate(
            async ({ endpoint: e, total }) => {
              const samples = [];
              for (let n = 0; n < 10; n++) {
                const start = performance.now();
                const r = await fetch(
                  `${e}/review-results?status=possible_match&sort=similarity_desc&page=${n + 1}&per_page=25`,
                );
                const body = await r.json();
                if (
                  r.status !== 200 ||
                  body.data.pagination.total !== total ||
                  body.data.data.length !== 25
                )
                  throw new Error("Reader count/page regression");
                samples.push(performance.now() - start);
              }
              return samples;
            },
            { endpoint, total: counts.possible_match },
          ),
        ),
      );
      const samples = batches.flat().sort((a, b) => a - b);
      metrics.push({
        reviewers,
        samples: samples.length,
        p50_ms: samples[Math.ceil(samples.length * 0.5) - 1],
        p95_ms: samples[Math.ceil(samples.length * 0.95) - 1],
        max_ms: samples.at(-1),
      });
      writeFileSync("review/uat-large-reader-final.json", JSON.stringify(metrics, null, 2));
    }
    console.log("UAT_READER_FINAL", JSON.stringify(metrics));
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
test("300k snapshots: 1/5/10 real-session reviewers, holds, persistence and export", async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const f = JSON.parse(readFileSync(fixturePath, "utf8"));
  const contexts = await Promise.all(
    Array.from({ length: 10 }, () => browser.newContext({ baseURL: "http://127.0.0.1:5178" })),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const endpoint = `/api/stage5a/workspaces/${f.workspace}/jobs/${f.job}`;
  const benchmark: unknown[] = [];
  try {
    // Serial login prevents authentication boot from contaminating measured load.
    for (let i = 0; i < pages.length; i++) await login(pages[i], `uat-reviewer-${i}`);
    const renderStart = Date.now();
    await pages[0].goto(`/matching?workspace=${f.workspace}`);
    await expect(pages[0].locator("tr[data-record-key]")).toHaveCount(25, { timeout: 60_000 });
    const browserRenderMs = Date.now() - renderStart;
    writeFileSync(
      "review/uat-large-browser.json",
      JSON.stringify({ first_table_render_ms: browserRenderMs }),
    );
    const datasetPaging = await pages[0].evaluate(
      async ({ workspace, input }) => {
        const result = [];
        for (const page of [1, 12000]) {
          const t = performance.now();
          const r = await fetch(
            `/api/stage5a/workspaces/${workspace}/datasets/${input}/rows?page=${page}&per_page=25`,
          );
          const data = await r.json();
          result.push({
            page,
            http: r.status,
            ms: performance.now() - t,
            total: data.data.total,
            partial: data.data.partial,
            source: data.data.source,
            rows: data.data.data.length,
          });
        }
        return result;
      },
      { workspace: f.workspace, input: f.input },
    );
    expect(
      datasetPaging.map((r) => ({
        http: r.http,
        total: r.total,
        partial: r.partial,
        rows: r.rows,
      })),
    ).toEqual([
      { http: 200, total: 300000, partial: false, rows: 25 },
      { http: 200, total: 300000, partial: false, rows: 25 },
    ]);
    writeFileSync("review/uat-dataset-paging.json", JSON.stringify(datasetPaging, null, 2));
    for (const reviewers of [1, 5, 10]) {
      const batches = await Promise.all(
        pages.slice(0, reviewers).map((page, i) =>
          page.evaluate(
            async ({ endpoint, i, reviewers }) => {
              const csrf = decodeURIComponent(
                document.cookie
                  .split("; ")
                  .find((c) => c.startsWith("XSRF-TOKEN="))!
                  .split("=")
                  .slice(1)
                  .join("="),
              );
              const read: number[] = [],
                write: number[] = [];
              for (let n = 0; n < 10; n++) {
                let t = performance.now();
                const r = await fetch(
                  `${endpoint}/review-results?sort=similarity_desc&status=possible_match&page=${n + 1}&per_page=25`,
                );
                const data = await r.json();
                read.push(performance.now() - t);
                if (r.status !== 200 || data.data.data.length !== 25)
                  throw Error(`read ${r.status}`);
                const key = String(10000 + reviewers * 1000 + i * 100 + n * 5 + 2).padStart(6, "0");
                const stateResponse = await fetch(`${endpoint}/review-results?record_key=${key}`);
                const state = (await stateResponse.json()).data.data[0];
                const candidates = await fetch(`${endpoint}/candidates?record_key=${key}`).then(
                  (r) => r.json(),
                );
                t = performance.now();
                const ack = await fetch(
                  `/api/stage5a/jobs/${endpoint.split("/").at(-1)}/decisions`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": csrf },
                    body: JSON.stringify({
                      idempotency_key: crypto.randomUUID(),
                      items: [
                        {
                          input_record_key: key,
                          expected_version: state.version,
                          decision: "accept_match",
                          candidate_id: candidates.data.data[0].id,
                        },
                      ],
                    }),
                  },
                );
                const body = await ack.json();
                write.push(performance.now() - t);
                if (ack.status !== 200 || body.data.applied !== 1)
                  throw Error(`write ${ack.status}: ${JSON.stringify(body)}`);
              }
              return { read, write };
            },
            { endpoint, i, reviewers },
          ),
        ),
      );
      const metrics = (values: number[]) => {
        values.sort((a, b) => a - b);
        return {
          samples: values.length,
          p50_ms: values[Math.floor(values.length * 0.5)],
          p95_ms: values[Math.ceil(values.length * 0.95) - 1],
          max_ms: values.at(-1),
        };
      };
      benchmark.push({
        reviewers,
        reader: metrics(batches.flatMap((b) => b.read)),
        decision: metrics(batches.flatMap((b) => b.write)),
      });
      writeFileSync("review/uat-large-api.json", JSON.stringify(benchmark, null, 2));
    }
    const prepareClaim = async (page: Page, key: string) =>
      page.evaluate(
        async ({ endpoint, key }) => {
          const state = await fetch(`${endpoint}/review-results?record_key=${key}`).then((r) =>
            r.json(),
          );
          const candidates = await fetch(`${endpoint}/candidates?record_key=${key}`).then((r) =>
            r.json(),
          );
          return {
            input_record_key: key,
            expected_version: state.data.data[0].version,
            decision: "accept_match",
            candidate_id: candidates.data.data[0].id,
          };
        },
        { endpoint, key },
      );
    const claim = async (page: Page, item: Awaited<ReturnType<typeof prepareClaim>>) =>
      page.evaluate(
        async ({ endpoint, item }) => {
          const csrf = decodeURIComponent(
            document.cookie
              .split("; ")
              .find((c) => c.startsWith("XSRF-TOKEN="))!
              .split("=")
              .slice(1)
              .join("="),
          );
          const r = await fetch(`/api/stage5a/jobs/${endpoint.split("/").at(-1)}/decisions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": csrf },
            body: JSON.stringify({ idempotency_key: crypto.randomUUID(), items: [item] }),
          });
          return r.status;
        },
        { endpoint, item },
      );
    const same = await Promise.all(pages.map((p) => prepareClaim(p, "290002")));
    const sameStatuses = await Promise.all(pages.map((p, i) => claim(p, same[i])));
    expect(sameStatuses.filter((s) => s === 200)).toHaveLength(1);
    expect(sameStatuses.filter((s) => s === 409)).toHaveLength(9);
    const entity = await Promise.all([
      prepareClaim(pages[0], "299996"),
      prepareClaim(pages[1], "299997"),
    ]);
    expect((await Promise.all(entity.map((item, i) => claim(pages[i], item)))).sort()).toEqual([
      200, 409,
    ]);
    const special = await pages[0].evaluate(async (endpoint) => {
      const csrf = decodeURIComponent(
        document.cookie
          .split("; ")
          .find((c) => c.startsWith("XSRF-TOKEN="))!
          .split("=")
          .slice(1)
          .join("="),
      );
      const result = [];
      for (const key of ["299998", "299999"]) {
        const s = await fetch(`${endpoint}/review-results?record_key=${key}`).then((r) => r.json());
        const r = await fetch(`/api/stage5a/jobs/${endpoint.split("/").at(-1)}/decisions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": csrf },
          body: JSON.stringify({
            idempotency_key: crypto.randomUUID(),
            items: [
              {
                input_record_key: key,
                expected_version: s.data.data[0].version,
                decision: "mark_unmatched",
              },
            ],
          }),
        });
        result.push({ key, http: r.status, state: s.data.data[0], body: await r.json() });
      }
      return result;
    }, endpoint);
    expect(special.map((r) => r.http)).toEqual([409, 409]);
    expect(special[0].state.duplicate_of_input_record_key).toBe("000000");
    expect(special[1].state.integrity_status).toBe("held");
    await pages[0].reload();
    await expect(pages[0].locator("tr[data-record-key]")).toHaveCount(25);
    const persisted = await pages[0].evaluate(
      async (e) => (await fetch(`${e}/review-results?record_key=011002`)).json(),
      endpoint,
    );
    expect(persisted.data.data[0]).toMatchObject({ status: "matched", version: 2 });
    const reconnect = await browser.newContext({ baseURL: "http://127.0.0.1:5178" });
    try {
      const p = await reconnect.newPage();
      await login(p, "uat-reviewer-0");
      expect(
        await p.evaluate(
          async (e) => (await fetch(`${e}/review-results?record_key=011002`)).json(),
          endpoint,
        ),
      ).toMatchObject({ data: { data: [{ status: "matched", version: 2 }] } });
      const exportStart = Date.now();
      const exported = await p.evaluate(async (e) => {
        const r = await fetch(`${e}/export`);
        const csv = await r.text();
        return {
          http: r.status,
          lines: csv.trim().split("\n").length,
          approved: csv.includes("011002,matched,accept_match"),
        };
      }, endpoint);
      expect(exported).toEqual({ http: 200, lines: 300001, approved: true });
      writeFileSync(
        "review/uat-large-browser.json",
        JSON.stringify({
          first_table_render_ms: browserRenderMs,
          export_ms: Date.now() - exportStart,
          export_rows: 300000,
        }),
      );
    } finally {
      await reconnect.close();
    }
    const ownerContext = await browser.newContext({ baseURL: "http://127.0.0.1:5178" });
    const viewerContext = await browser.newContext({ baseURL: "http://127.0.0.1:5178" });
    try {
      const owner = await ownerContext.newPage(),
        viewer = await viewerContext.newPage();
      await login(owner, "e2e-owner");
      await login(viewer, "e2e-viewer");
      const pending = viewer.evaluate(async (e) => {
        const r = await fetch(`${e}/export`);
        return {
          http: r.status,
          type: r.headers.get("Content-Type"),
          body: (await r.text()).slice(0, 200),
        };
      }, endpoint);
      // A large export cannot complete its 600 reauthorized chunks in this interval.
      await owner.waitForTimeout(150);
      const revoked = await owner.evaluate(async (workspace) => {
        const m = await fetch(`/api/stage5a/workspaces/${workspace}/members`).then((r) => r.json());
        const v = m.data.data.find(
          (u: { email: string }) => u.email === "e2e-viewer@isolated.invalid",
        );
        const csrf = decodeURIComponent(
          document.cookie
            .split("; ")
            .find((c) => c.startsWith("XSRF-TOKEN="))!
            .split("=")
            .slice(1)
            .join("="),
        );
        return fetch(`/api/stage5a/workspaces/${workspace}/members/${v.user_id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": csrf },
          body: JSON.stringify({ expected_version: v.version }),
        }).then((r) => r.status);
      }, f.workspace);
      expect(revoked).toBe(200);
      const result = await pending;
      expect(result.http).toBe(403);
      expect(result.type).toContain("application/json");
      expect(result.body).not.toContain("input_record_key,status,decision");
    } finally {
      await ownerContext.close();
      await viewerContext.close();
    }
    console.log("UAT_LARGE_API", JSON.stringify(benchmark));
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
