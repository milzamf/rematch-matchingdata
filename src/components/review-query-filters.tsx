import { useEffect, useState } from "react";
import { usePreferences } from "@/lib/preferences";
import type { ReviewQueryFilters, ReviewRegionOptions } from "@/lib/api";
import { SearchableSelect } from "@/components/ui/searchable-select";

export function ReviewQueryFilterControls({ value, onChange, regions, error, onRetry }: {
  value: ReviewQueryFilters;
  onChange: (value: ReviewQueryFilters) => void;
  regions: ReviewRegionOptions | null;
  error: string | null;
  onRetry: () => void;
}) {
  const { t } = usePreferences();
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [rangeError, setRangeError] = useState(false);
  useEffect(() => {
    setMin(value.similarity_min === undefined ? "" : String(value.similarity_min));
    setMax(value.similarity_max === undefined ? "" : String(value.similarity_max));
    setRangeError(false);
  }, [value.similarity_min, value.similarity_max]);
  const selectClass = "h-9 rounded-md border border-border bg-background px-2 text-xs";
  return <div className="mb-4 rounded-lg border border-border bg-secondary/10 p-3">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="space-y-1 text-xs"><span>{t("review.filters.sort")}</span>
        <SearchableSelect searchable={false} aria-label={t("review.filters.sort")} value={value.sort}
          onChange={sort => onChange({ ...value, sort: sort as ReviewQueryFilters["sort"] })}
          options={[
            { value: "record_order", label: t("review.filters.recordOrder") },
            { value: "similarity_desc", label: t("review.filters.highest") },
            { value: "similarity_asc", label: t("review.filters.lowest") },
          ]} />
      </div>
      <div className="space-y-1 text-xs"><span>{t("review.filters.province")}</span>
        <SearchableSelect aria-label={t("review.filters.province")} value={value.input_province_code ?? ""} onChange={code => onChange({ ...value, input_province_code: code || undefined, input_regency_code: undefined })}
          options={[{ value: "", label: t("review.filters.allProvinces") }, ...(regions?.provinces ?? []).map(p => ({ value: p.code, label: p.label }))]}
          disabled={!regions?.ready} placeholder={t("review.filters.allProvinces")} />
      </div>
      <div className="space-y-1 text-xs"><span>{t("review.filters.regency")}</span>
        <SearchableSelect aria-label={t("review.filters.regency")} value={value.input_regency_code ?? ""} onChange={code => onChange({ ...value, input_regency_code: code || undefined })}
          options={[{ value: "", label: t("review.filters.allRegencies") }, ...(regions?.regencies ?? []).filter(p => !value.input_province_code || p.province_code === value.input_province_code).map(p => ({ value: p.code, label: p.label }))]}
          disabled={!regions?.ready} placeholder={t("review.filters.allRegencies")} />
      </div>
      <form className="space-y-1 text-xs" onSubmit={e => {
        e.preventDefault();
        const minimum = min === "" ? undefined : Number(min);
        const maximum = max === "" ? undefined : Number(max);
        if (minimum !== undefined && maximum !== undefined && minimum > maximum) { setRangeError(true); return; }
        setRangeError(false);
        onChange({ ...value, similarity_min: minimum, similarity_max: maximum });
      }}>
        <span>{t("review.filters.range")}</span>
        <div className="flex gap-1">
          <input aria-label={t("review.filters.minimum")} type="number" min={0} max={100} step="any" value={min} onChange={e => setMin(e.target.value)} placeholder="0" className={`${selectClass} w-16 flex-1 min-w-0`} />
          <input aria-label={t("review.filters.maximum")} type="number" min={0} max={100} step="any" value={max} onChange={e => setMax(e.target.value)} placeholder="100" className={`${selectClass} w-16 flex-1 min-w-0`} />
          <button className={`${selectClass} cursor-pointer hover:bg-secondary`}>{t("review.filters.apply")}</button>
        </div>
      </form>
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{error ? <>{error} <button onClick={onRetry} className="underline">{t("common.retry")}</button></> : !regions?.ready ? t("review.filters.preparing") : t("review.filters.inputRegion")}</span>
      <button onClick={() => { setMin(""); setMax(""); setRangeError(false); onChange({ sort: "record_order" }); }} className="cursor-pointer underline">{t("review.filters.reset")}</button>
    </div>
    {rangeError && <p role="alert" className="mt-2 text-xs text-destructive">{t("review.filters.invalidRange")}</p>}
  </div>;
}
