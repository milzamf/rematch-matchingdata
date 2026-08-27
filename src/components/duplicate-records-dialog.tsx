import { useState, useMemo } from "react";
import { Building2, Copy, Hash, Layers, MapPin, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TablePagination } from "@/components/ui/table-pagination";
import { usePreferences } from "@/lib/preferences";
import type { DuplicateDetail } from "@/lib/api";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value);
}

function extractEntityDisplay(row: Record<string, unknown> = {}) {
  const entries = Object.entries(row).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim() !== "",
  );

  // 1. Company Name Detection
  // Priority 1: Exact column names for company / vendor name
  let nameEntry = entries.find(([k]) =>
    /^(nama_penyedia|nama_perusahaan|nama_badan_usaha|namaperusahaan|namapenyedia|nama_usaha|nama_vendor|company_name|company_legal_name|nama|nama_lengkap)$/i.test(
      k.trim(),
    ),
  );

  // Priority 2: Keys containing 'nama' but NOT 'kd|kode|id|no|prov|kab|kec|kel|dokumen|user|pic|petugas|bank|rek'
  if (!nameEntry) {
    nameEntry = entries.find(([k]) => {
      if (/kd|kode|id|no|num|prov|kab|kec|kel|dokumen|file|user|pic|petugas|bank|rek/i.test(k))
        return false;
      return /nama/i.test(k);
    });
  }

  // Priority 3: Keys containing 'penyedia|perusahaan|vendor|company' but NOT 'kd|kode|id|no|alamat|npwp|email|telp|phone|hp|rek|bank'
  if (!nameEntry) {
    nameEntry = entries.find(([k]) => {
      if (/kd|kode|id|no|num|alamat|npwp|email|telp|phone|hp|rek|bank|rekening/i.test(k))
        return false;
      return /penyedia|perusahaan|vendor|company|entity/i.test(k);
    });
  }

  // Priority 4: Look for non-code text string with letters (>= 3 chars)
  if (!nameEntry) {
    nameEntry = entries.find(([k, v]) => {
      if (
        /kd|kode|id|no|num|npwp|alamat|jalan|prov|kab|kec|kel|email|telp|phone|hp|tgl|date|time/i.test(
          k,
        )
      )
        return false;
      const str = String(v).trim();
      return /^[a-zA-Z\s.,&()'-]{3,}$/.test(str);
    });
  }

  const companyName = nameEntry ? String(nameEntry[1]).trim() : String(entries[0]?.[1] ?? "-");

  // 2. Address Detection
  const addressParts: string[] = [];
  const addressEntry = entries.find(
    ([k]) =>
      /^(alamat_penyedia|alamat_perusahaan|alamat_kantor|alamat|address|jalan|street|lokasi)$/i.test(
        k.trim(),
      ) ||
      (/alamat/i.test(k) && !/email/i.test(k)),
  );
  if (addressEntry) {
    addressParts.push(String(addressEntry[1]).trim());
  }

  // City / Regency
  const cityEntry = entries.find(
    ([k]) =>
      /^(nmkab|kabupaten|kab_kota|kota|city|kabupaten_kota|kab)$/i.test(k.trim()) ||
      (/kab|kota/i.test(k) && !/alamat|prov/i.test(k)),
  );
  if (
    cityEntry &&
    !addressParts.some((p) => p.toLowerCase().includes(String(cityEntry[1]).toLowerCase()))
  ) {
    addressParts.push(String(cityEntry[1]).trim());
  }

  // Province
  const provEntry = entries.find(
    ([k]) =>
      /^(nmprov|provinsi|province|prov)$/i.test(k.trim()) ||
      (/prov/i.test(k) && !/alamat|kab|kota/i.test(k)),
  );
  if (
    provEntry &&
    !addressParts.some((p) => p.toLowerCase().includes(String(provEntry[1]).toLowerCase()))
  ) {
    addressParts.push(String(provEntry[1]).trim());
  }

  const fullAddress = addressParts.filter(Boolean).join(", ");

  // 3. NPWP / Strong Identifiers
  const npwpEntry = entries.find(([k]) => /npwp|nomor_npwp|tax_id|taxid|nib/i.test(k));
  const npwpValue = npwpEntry ? String(npwpEntry[1]).trim() : null;
  const npwpLabel = npwpEntry ? npwpEntry[0].replace(/_/g, " ").toUpperCase() : "NPWP";

  // 4. Code / ID (e.g. kd_penyedia)
  const codeEntry = entries.find(
    ([k]) =>
      /^(kd_penyedia|id_penyedia|kd_peserta|id_perusahaan|kode_perusahaan|kd_vendor|id_vendor)$/i.test(
        k.trim(),
      ) ||
      (/^(kd|id|kode)_/i.test(k.trim()) && !/prov|kab|kec|npwp/i.test(k.trim())),
  );
  const codeValue = codeEntry
    ? { label: codeEntry[0].replace(/_/g, " "), value: String(codeEntry[1]).trim() }
    : null;

  return {
    companyName,
    fullAddress,
    npwpLabel,
    npwpValue,
    codeValue,
  };
}

export function DuplicateSummaryBanner({
  totalRaw,
  totalUnique,
  totalDuplicates,
  duplicateDetails = [],
  onViewDetails,
}: {
  totalRaw: number;
  totalUnique: number;
  totalDuplicates: number;
  duplicateDetails?: DuplicateDetail[];
  onViewDetails?: () => void;
}) {
  const { t } = usePreferences();

  if (totalDuplicates <= 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-secondary/15 p-4 transition-all">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <Layers className="size-5" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground">{t("matching.dedup.title")}</h4>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("matching.dedup.desc")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-md bg-secondary px-2.5 py-1 font-semibold tabular-nums text-foreground">
              {formatNumber(totalRaw)}{" "}
              <span className="font-normal text-muted-foreground">total baris</span>
            </span>
            <span className="rounded-md bg-warning/15 px-2.5 py-1 font-semibold tabular-nums text-warning">
              {formatNumber(totalDuplicates)}{" "}
              <span className="font-normal text-muted-foreground">duplikat diabaikan</span>
            </span>
            <span className="rounded-md bg-success/15 px-2.5 py-1 font-semibold tabular-nums text-success">
              {formatNumber(totalUnique)}{" "}
              <span className="font-normal text-muted-foreground">unik diproses</span>
            </span>
          </div>

          {duplicateDetails.length > 0 && onViewDetails && (
            <button
              type="button"
              onClick={onViewDetails}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary cursor-pointer"
            >
              <Copy className="size-3.5 text-muted-foreground" />
              <span>{t("matching.dedup.viewDetails")}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DuplicateRecordsDialog({
  open,
  onOpenChange,
  totalRaw,
  totalUnique,
  totalDuplicates,
  duplicateDetails,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalRaw: number;
  totalUnique: number;
  totalDuplicates: number;
  duplicateDetails: DuplicateDetail[];
}) {
  const { t } = usePreferences();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filtered = useMemo(() => {
    if (!query) return duplicateDetails;
    const lower = query.toLowerCase();
    return duplicateDetails.filter((item) => {
      const values = Object.values(item.sample_row || {}).join(" ").toLowerCase();
      return values.includes(lower);
    });
  }, [duplicateDetails, query]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-6">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-brand/10 text-brand">
              <Layers className="size-4" />
            </div>
            <DialogTitle className="text-base font-semibold">
              {t("matching.dedup.modalTitle")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("matching.dedup.modalDesc")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-secondary/20 p-3 text-xs">
          <div>
            <span className="text-muted-foreground uppercase text-[10px] font-semibold">
              Total Baris Input
            </span>
            <p className="mt-0.5 text-base font-bold tabular-nums text-foreground">
              {formatNumber(totalRaw)}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground uppercase text-[10px] font-semibold">
              Duplikat Diabaikan
            </span>
            <p className="mt-0.5 text-base font-bold tabular-nums text-warning">
              {formatNumber(totalDuplicates)}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground uppercase text-[10px] font-semibold">
              Entitas Unik Diproses
            </span>
            <p className="mt-0.5 text-base font-bold tabular-nums text-success">
              {formatNumber(totalUnique)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Cari nama perusahaan, alamat, atau NPWP duplikat..."
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-8 text-xs outline-none focus:border-brand"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-secondary/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider sticky top-0">
              <tr>
                <th className="w-12 px-3 py-2 text-center">No</th>
                <th className="w-20 px-3 py-2">Baris #</th>
                <th className="px-3 py-2">Identitas Perusahaan / Entitas</th>
                <th className="w-28 px-3 py-2 text-right">Kemunculan</th>
                <th className="w-32 px-3 py-2 text-right">Duplikat Diabaikan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">
                    Tidak ada data duplikat yang sesuai pencarian
                  </td>
                </tr>
              ) : (
                paged.map((item, index) => {
                  const globalIdx = (page - 1) * pageSize + index + 1;
                  const display = extractEntityDisplay(item.sample_row || {});

                  return (
                    <tr
                      key={`${item.first_row_index}-${globalIdx}`}
                      className="hover:bg-secondary/20 transition-colors"
                    >
                      <td className="px-3 py-2.5 text-center font-medium text-muted-foreground tabular-nums">
                        {globalIdx}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                        #{item.first_row_index}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Building2 className="size-3.5 text-brand shrink-0" />
                            <p className="font-semibold text-foreground text-[13px] leading-snug">
                              {display.companyName}
                            </p>
                          </div>

                          {display.fullAddress && (
                            <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                              <MapPin className="size-3 text-muted-foreground shrink-0 mt-0.5" />
                              <span className="line-clamp-2 leading-relaxed">
                                {display.fullAddress}
                              </span>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            {display.npwpValue && (
                              <span className="inline-flex items-center gap-1 rounded bg-secondary/80 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                                <span className="font-semibold text-foreground/80">
                                  {display.npwpLabel}:
                                </span>
                                {display.npwpValue}
                              </span>
                            )}
                            {display.codeValue && (
                              <span className="inline-flex items-center gap-1 rounded bg-secondary/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                                <Hash className="size-2.5 text-muted-foreground" />
                                <span className="font-semibold">{display.codeValue.label}:</span>
                                {display.codeValue.value}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">
                        {item.total_occurrences}x baris
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-warning">
                        +{item.duplicate_count} baris
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="pt-2">
            <TablePagination
              currentPage={page}
              pageSize={pageSize}
              totalItems={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
