import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLayout, PageHeader } from "@/components/app-layout";
import { TablePagination } from "@/components/ui/table-pagination";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useAuth } from "@/lib/auth";
import { accessApi, type SharedFilters } from "@/lib/workspace-access";
import { ManageAccessButton } from "./access-management";
import { ApprovalInbox } from "./approval-inbox";
import { SharedWorkspaces } from "./shared-workspaces";
import { VersionedReview } from "./versioned-review";
import { useWorkspaceAccess } from "./use-workspace-access";
import { AccessFeedback, accessButton } from "./access-feedback";
import provinces from "@/lib/wilayah/provinces.json";
import regencies from "@/lib/wilayah/regencies.json";

export function SharedMatching({
  workspaceId,
  results = false,
}: {
  workspaceId?: string;
  results?: boolean;
}) {
  if (!workspaceId) return <SharedWorkspaces />;
  return <SharedWorkspaceDetail key={workspaceId} workspaceId={workspaceId} results={results} />;
}
function SharedWorkspaceDetail({
  workspaceId,
  results,
}: {
  workspaceId: string;
  results: boolean;
}) {
  const { currentUser } = useAuth();
  const permission = useWorkspaceAccess(workspaceId);
  const client = useQueryClient();
  const readable = !!permission.access?.permissions.read;
  const [filters, setFilters] = useState<SharedFilters>({
    page: 1,
    per_page: 25,
    sort: "record_order",
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [candidatePage, setCandidatePage] = useState(1);
  const [dataset, setDataset] = useState<string | null>(null);
  const [datasetPage, setDatasetPage] = useState(1);
  const [exportError, setExportError] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);
  const workspace = useQuery({
    queryKey: ["stage5a", "workspace-meta", currentUser?.id, workspaceId],
    enabled: readable,
    retry: false,
    queryFn: ({ signal }) => accessApi.workspace(workspaceId, signal),
  });
  const w = workspace.data?.workspace;
  const job = workspace.data?.job;
  const ready = readable && !!job?.ready;
  const review = useQuery({
    queryKey: ["stage5a", "review", job?.id, currentUser?.id, workspaceId, filters],
    enabled: ready,
    retry: false,
    queryFn: ({ signal }) => accessApi.review(workspaceId, job!.id, filters, signal),
  });
  const focused = useQuery({
    queryKey: ["stage5a", "review", job?.id, currentUser?.id, workspaceId, "record", selected],
    enabled: ready && selected !== null,
    retry: false,
    queryFn: ({ signal }) =>
      accessApi.review(workspaceId, job!.id, { record_key: selected! }, signal),
  });
  const candidates = useQuery({
    queryKey: ["stage5a", "candidates", job?.id, currentUser?.id, selected, candidatePage],
    enabled: ready && selected !== null,
    retry: false,
    queryFn: ({ signal }) =>
      accessApi.candidates(workspaceId, job!.id, selected!, candidatePage, signal),
  });
  const preview = useQuery({
    queryKey: ["stage5a", "dataset", workspaceId, currentUser?.id, dataset, datasetPage],
    enabled: readable && dataset !== null,
    retry: false,
    queryFn: ({ signal }) => accessApi.dataset(workspaceId, dataset!, datasetPage, signal),
  });
  const change = (patch: Partial<SharedFilters>) =>
    setFilters((f) => ({ ...f, ...patch, page: 1 }));
  const reload = async () => {
    await permission.refetch();
    await Promise.all([
      client.invalidateQueries({ queryKey: ["stage5a", "review", job?.id] }),
      client.invalidateQueries({ queryKey: ["stage5a", "candidates", job?.id] }),
      client.invalidateQueries({ queryKey: ["stage5a", "proposals", job?.id] }),
      workspace.refetch(),
    ]);
  };
  const exportResults = async () => {
    if (!job || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const blob = await accessApi.export(workspaceId, job.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "review-results.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError(e);
      await permission.refetch();
    } finally {
      setExporting(false);
    }
  };
  const state = focused.data?.data[0];
  const fatal =
    !readable ||
    (review.error instanceof Error && "status" in review.error && review.error.status === 403);
  return (
    <AppLayout>
      <main className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
        <PageHeader
          title={results ? "Hasil" : "Matching"}
          description="Workspace bersama · data dan keputusan aktual"
          actions={
            <Link to="/workspaces" className={accessButton}>
              Daftar Workspace
            </Link>
          }
        />
        <AccessFeedback error={permission.error ?? workspace.error} reload={() => void reload()} />
        {permission.isPending && <p role="status">Memeriksa akses workspace…</p>}
        {!fatal && w && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
              <div>
                <h2 className="text-sm font-semibold">{w.name}</h2>
                <p className="text-xs text-muted-foreground">
                  Pemilik: {workspace.data?.owner.name} · {w.status} · Akses:{" "}
                  {permission.access?.role}
                </p>
              </div>
              <ManageAccessButton
                label="Bagikan Workspace"
                workspaceId={w.id}
                name={w.name}
                owner={workspace.data?.owner.name ?? ""}
              />
              <button className={accessButton} onClick={() => void reload()}>
                Muat Data Terbaru
              </button>
              <Link
                to={results ? "/matching" : "/results"}
                search={{ workspace: w.id }}
                className={accessButton}
              >
                {results ? "Review" : "Lihat Hasil"}
              </Link>
            </div>
            {job && (
              <p className="text-sm">
                Matching: {job.status} · {job.processed_count ?? 0} / {job.total_count ?? 0} ·
                Review: {job.review_state_readiness}
              </p>
            )}
            {job && !job.ready && (
              <p role="status">
                Review state belum siap. Keputusan belum dapat dibaca atau disimpan.
              </p>
            )}
            <section className="rounded-lg border p-3 space-y-2" aria-label="Dataset">
              <h2 className="text-sm font-semibold">Dataset</h2>
              {Object.entries(job?.datasets ?? workspace.data?.datasets ?? {}).map(([role, d]) => (
                <button
                  className={accessButton}
                  key={role}
                  onClick={() => {
                    setDataset(d.id);
                    setDatasetPage(1);
                  }}
                >
                  {role.startsWith("input") ? "Input" : "Acuan"}: {d.name} ({d.row_count})
                </button>
              ))}
              <AccessFeedback error={preview.error} reload={() => void preview.refetch()} />
              {preview.isFetching && dataset && <p role="status">Memperbarui pratinjau…</p>}
              {preview.data && dataset && (
                <>
                  <p className="text-xs">
                    {preview.data.partial
                      ? "Pratinjau parsial; file sumber tidak tersedia."
                      : "Baris dari file sumber."}
                  </p>
                  <div className="overflow-auto max-h-64">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          {Object.keys(preview.data.data[0] ?? {}).map((c) => (
                            <th className="p-2 text-left" key={c}>
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.data.data.map((r, i) => (
                          <tr key={i}>
                            {Object.values(r).map((v, j) => (
                              <td className="p-2 border-t" key={j}>
                                {String(v ?? "")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <TablePagination
                    currentPage={datasetPage}
                    pageSize={25}
                    totalItems={preview.data.total}
                    onPageChange={setDatasetPage}
                  />
                </>
              )}
            </section>
            {ready && (
              <>
                <section
                  className="grid gap-3 sm:grid-cols-3 rounded-lg border p-3"
                  aria-label="Filter review"
                >
                  <SearchableSelect
                    aria-label="Status record"
                    searchable={false}
                    value={filters.status ?? ""}
                    onChange={(v) => change({ status: v || undefined })}
                    options={[
                      { value: "", label: "Semua" },
                      { value: "possible_match", label: "Need Review" },
                      { value: "matched", label: "Matched" },
                      { value: "unmatched", label: "Unmatched" },
                      { value: "duplicate_input", label: "Duplicate Input" },
                      { value: "reference_conflict", label: "Reference Conflict" },
                    ]}
                  />
                  <SearchableSelect
                    aria-label="Urutkan"
                    searchable={false}
                    value={filters.sort ?? "record_order"}
                    onChange={(sort) => change({ sort })}
                    options={[
                      { value: "record_order", label: "Urutan data" },
                      { value: "similarity_desc", label: "Similarity tertinggi" },
                      { value: "similarity_asc", label: "Similarity terendah" },
                    ]}
                  />
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      change({
                        search:
                          String(new FormData(e.currentTarget).get("search") ?? "") || undefined,
                      });
                    }}
                  >
                    <input
                      name="search"
                      aria-label="Cari record"
                      placeholder="Cari record"
                      className="rounded-md border p-2 w-full"
                    />
                    <button className={accessButton}>Cari</button>
                  </form>
                  <SearchableSelect
                    aria-label="Provinsi input"
                    disabled={!job?.region_filters_ready}
                    value={filters.input_province_code ?? ""}
                    onChange={(code) =>
                      change({
                        input_province_code: code || undefined,
                        input_regency_code: undefined,
                      })
                    }
                    options={[
                      { value: "", label: "Semua provinsi" },
                      ...Object.values(provinces).map((p) => ({
                        value: p.kd_prov,
                        label: p.nm_prov,
                      })),
                    ]}
                  />
                  <SearchableSelect
                    aria-label="Kabupaten / kota input"
                    disabled={!job?.region_filters_ready}
                    value={filters.input_regency_code ?? ""}
                    onChange={(code) => change({ input_regency_code: code || undefined })}
                    options={[
                      { value: "", label: "Semua kabupaten / kota" },
                      ...Object.values(regencies)
                        .filter(
                          (r) =>
                            !filters.input_province_code ||
                            r.kd_prov === filters.input_province_code,
                        )
                        .map((r) => ({ value: r.id_kab, label: r.full_name })),
                    ]}
                  />
                  <form
                    className="flex flex-wrap gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const min = String(f.get("min"));
                      const max = String(f.get("max"));
                      change({
                        similarity_min: min ? Number(min) : undefined,
                        similarity_max: max ? Number(max) : undefined,
                      });
                    }}
                  >
                    <input
                      className="w-20 rounded-md border p-2"
                      type="number"
                      min="0"
                      max="100"
                      name="min"
                      aria-label="Similarity minimum"
                      placeholder="0"
                    />
                    <input
                      className="w-20 rounded-md border p-2"
                      type="number"
                      min="0"
                      max="100"
                      name="max"
                      aria-label="Similarity maximum"
                      placeholder="100"
                    />
                    <button className={accessButton}>Terapkan</button>
                  </form>
                  <button
                    className={accessButton}
                    onClick={() => setFilters({ page: 1, per_page: 25, sort: "record_order" })}
                  >
                    Reset filter
                  </button>
                </section>
                <AccessFeedback error={review.error} reload={() => void reload()} />
                {review.data && (
                  <p className="text-sm" data-testid="review-summary">
                    {Object.entries(review.data.summary)
                      .map(([s, n]) => `${s}: ${n}`)
                      .join(" · ")}
                  </p>
                )}
                <div
                  className="min-h-[360px] rounded-lg border overflow-auto"
                  aria-busy={review.isFetching}
                >
                  {review.isFetching && (
                    <p className="p-2 text-xs" role="status">
                      Memperbarui…
                    </p>
                  )}
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="p-3 text-left">Input</th>
                        <th>Acuan</th>
                        <th>Similarity</th>
                        <th>Status</th>
                        <th>Versi</th>
                        <th>Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {review.data?.data.map((r) => (
                        <tr
                          className="border-t"
                          key={r.input_record_key}
                          data-record-key={r.input_record_key}
                        >
                          <td className="p-3">
                            {r.input_record_key}
                            <div className="text-xs text-muted-foreground">
                              {Object.values(r.displayed_candidate?.input_record ?? {})
                                .map(String)
                                .join(" · ")}
                            </div>
                          </td>
                          <td>{r.displayed_candidate?.reference_record_key ?? "—"}</td>
                          <td>{r.similarity_score === null ? "—" : `${r.similarity_score}%`}</td>
                          <td>{r.status}</td>
                          <td>{r.version}</td>
                          <td>
                            <button
                              className={accessButton}
                              onClick={() => {
                                setSelected(r.input_record_key);
                                setCandidatePage(1);
                              }}
                            >
                              Buka Review
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!review.data &&
                        !review.error &&
                        Array.from({ length: 5 }, (_, i) => (
                          <tr key={i} className="h-16 animate-pulse bg-secondary/30">
                            <td colSpan={6} />
                          </tr>
                        ))}
                      {review.data?.data.length === 0 && (
                        <tr>
                          <td className="p-8 text-center" colSpan={6}>
                            Tidak ada record yang memenuhi filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {review.data && (
                  <TablePagination
                    currentPage={Number(filters.page)}
                    pageSize={Number(filters.per_page)}
                    totalItems={review.data.pagination.total}
                    onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
                    onPageSizeChange={(per_page) => change({ per_page })}
                  />
                )}
                {selected !== null && (
                  <section aria-label="Detail review" className="space-y-3">
                    <button className={accessButton} onClick={() => setSelected(null)}>
                      Tutup Detail
                    </button>
                    <AccessFeedback
                      error={focused.error ?? candidates.error}
                      reload={() => void reload()}
                    />
                    {state && candidates.data && (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {[
                            ["Data input", state.displayed_candidate?.input_record],
                            ["Data acuan", state.displayed_candidate?.reference_record],
                          ].map(([title, record]) => (
                            <div className="rounded-lg border p-3 text-sm" key={String(title)}>
                              <h3 className="font-semibold">{String(title)}</h3>
                              <dl>
                                {Object.entries(
                                  typeof record === "object" && record !== null ? record : {},
                                ).map(([name, value]) => (
                                  <div className="border-t py-2" key={name}>
                                    <dt className="text-xs text-muted-foreground">{name}</dt>
                                    <dd>{String(value ?? "—")}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          ))}
                        </div>
                        <div className="overflow-auto rounded-lg border p-3 text-sm">
                          <p>
                            Similarity: {state.similarity_score ?? "—"}% · Integritas:{" "}
                            {state.integrity_status} · Lineage: {state.lineage_status}
                          </p>
                          {state.duplicate_of_input_record_key && (
                            <p>Input canonical: {state.duplicate_of_input_record_key}</p>
                          )}
                          <table className="w-full text-xs">
                            <thead>
                              <tr>
                                <th className="p-2 text-left">Kolom input</th>
                                <th>Kolom acuan</th>
                                <th>Similarity</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(Array.isArray(state.displayed_candidate?.field_scores)
                                ? state.displayed_candidate!.field_scores.filter(
                                    (v): v is Record<string, unknown> =>
                                      typeof v === "object" && v !== null,
                                  )
                                : Object.entries(state.displayed_candidate?.field_scores ?? {}).map(
                                    ([name, score]) => ({
                                      input_column: name,
                                      reference_column: name,
                                      score,
                                    }),
                                  )
                              ).map((field, i) => (
                                <tr className="border-t" key={i}>
                                  <td className="p-2">{String(field.input_column ?? "—")}</td>
                                  <td>{String(field.reference_column ?? "—")}</td>
                                  <td>{String(field.score ?? "—")}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="text-xs text-muted-foreground">
                            Pengusul: {state.actors.proposer.name ?? "—"} · Penyetuju:{" "}
                            {state.actors.approver.name ?? "—"} · Perubahan terakhir:{" "}
                            {state.actors.last_modifier.name ?? "—"}
                          </p>
                        </div>
                        <VersionedReview
                          key={state.input_record_key}
                          jobId={job!.id}
                          actorId={Number(currentUser?.id)}
                          access={{
                            ...permission.access!,
                            permissions: {
                              ...permission.access!.permissions,
                              review:
                                state.actions.review &&
                                candidates.data.version === state.version &&
                                !focused.isFetching &&
                                !candidates.isFetching,
                              propose:
                                state.actions.propose &&
                                candidates.data.version === state.version &&
                                !focused.isFetching &&
                                !candidates.isFetching,
                            },
                          }}
                          reload={reload}
                          record={{
                            key: state.input_record_key,
                            version: state.version,
                            decision: state.decision,
                            status: state.status,
                            reviewerId: state.actors.reviewer.id,
                            reviewerName: state.actors.reviewer.name,
                            protection: state.decision_protection,
                            origin: state.decision_origin,
                            candidates: candidates.data.data.map((c) => ({
                              id: c.id,
                              referenceKey: c.reference_record_key,
                              label: `#${c.rank} ${c.reference_record_key} (${c.score ?? "—"}%)`,
                              disabled: c.reference_occupied || c.integrity_hold,
                            })),
                          }}
                        />
                        <TablePagination
                          currentPage={candidatePage}
                          pageSize={25}
                          totalItems={candidates.data.pagination.total}
                          onPageChange={setCandidatePage}
                        />
                      </>
                    )}
                    {state && candidates.data && candidates.data.version !== state.version && (
                      <p role="status">
                        Versi kandidat berubah. Muat data terbaru sebelum memutuskan.
                      </p>
                    )}
                  </section>
                )}
                {permission.access?.permissions.export_read && (
                  <button
                    className={accessButton}
                    disabled={exporting}
                    onClick={() => void exportResults()}
                  >
                    {exporting ? "Mengekspor…" : "Ekspor hasil CSV"}
                  </button>
                )}
                <AccessFeedback error={exportError} reload={() => setExportError(null)} />
              </>
            )}
            {job && <ApprovalInbox workspaceId={w.id} name={w.name} jobId={job.id} />}
          </>
        )}
      </main>
    </AppLayout>
  );
}
