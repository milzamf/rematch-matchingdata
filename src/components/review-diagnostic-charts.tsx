import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Layers,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/app-layout";
import type { ReviewItem } from "@/lib/api";
import { usePreferences } from "@/lib/preferences";

export interface ColumnMappingDraft {
  id?: string;
  referenceColumnId?: string;
  inputColumnId?: string;
  algorithm?: string;
  weight?: number;
  strict?: boolean;
}

export interface ReviewDiagnosticChartsProps {
  items: ReviewItem[];
  columnMappings?: ColumnMappingDraft[];
  thresholds?: {
    autoMatch?: number;
    review?: number;
    noMatch?: number;
    auto_match?: number;
    needs_review?: number;
    [key: string]: unknown;
  } | null;
  autoMatchThreshold?: number;
  reviewThreshold?: number;
  defaultExpanded?: boolean;
}

export interface FieldQualityStat {
  fieldKey: string;
  referenceColumn: string;
  inputColumn: string;
  totalEvaluated: number;
  avgScore: number;
  highCount: number;
  medCount: number;
  lowCount: number;
  highPct: number;
  medPct: number;
  lowPct: number;
}

export interface ParetoStat {
  id: string;
  labelKey: string;
  count: number;
  percentage: number;
  cumulativeCount: number;
  cumulativePercentage: number;
  isVitalFew: boolean;
}

export function ReviewDiagnosticCharts({
  items,
  columnMappings = [],
  thresholds,
  autoMatchThreshold,
  reviewThreshold,
  defaultExpanded = true,
}: ReviewDiagnosticChartsProps) {
  const { t } = usePreferences();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [activeTab, setActiveTab] = useState<"heatmap" | "pareto">("heatmap");

  // Dynamic thresholds resolution from active matching configuration
  const autoMatch = Math.max(
    1,
    Math.min(
      100,
      Math.round(
        typeof autoMatchThreshold === "number"
          ? autoMatchThreshold
          : typeof thresholds?.autoMatch === "number"
            ? thresholds.autoMatch
            : typeof thresholds?.auto_match === "number"
              ? thresholds.auto_match
              : 85,
      ),
    ),
  );

  const reviewMin = Math.max(
    0,
    Math.min(
      autoMatch,
      Math.round(
        typeof reviewThreshold === "number"
          ? reviewThreshold
          : typeof thresholds?.review === "number"
            ? thresholds.review
            : typeof thresholds?.needs_review === "number"
              ? thresholds.needs_review
              : 70,
      ),
    ),
  );

  // 1. Compute Field Quality Summary Data across mapped comparison fields with dynamic thresholds
  const fieldQualityStats = useMemo<FieldQualityStat[]>(() => {
    if (!items || items.length === 0) return [];

    const statsMap = new Map<
      string,
      {
        referenceColumn: string;
        inputColumn: string;
        scores: number[];
      }
    >();

    for (const item of items) {
      const topCandidate = item.candidates?.[0];
      if (!topCandidate || !topCandidate.field_scores) continue;

      for (const field of topCandidate.field_scores) {
        const key = `${field.reference_column}:::${field.input_column}`;
        if (!statsMap.has(key)) {
          statsMap.set(key, {
            referenceColumn: field.reference_column,
            inputColumn: field.input_column,
            scores: [],
          });
        }
        const score = typeof field.score === "number" ? Math.max(0, Math.min(100, field.score)) : 0;
        statsMap.get(key)!.scores.push(score);
      }
    }

    // Fallback: If items don't have candidate field_scores populated, use columnMappings
    if (statsMap.size === 0 && columnMappings.length > 0) {
      for (const mapping of columnMappings) {
        if (!mapping.referenceColumnId || !mapping.inputColumnId) continue;
        const key = `${mapping.referenceColumnId}:::${mapping.inputColumnId}`;
        statsMap.set(key, {
          referenceColumn: mapping.referenceColumnId,
          inputColumn: mapping.inputColumnId,
          scores: [],
        });
      }
    }

    const result: FieldQualityStat[] = [];
    for (const [key, val] of statsMap.entries()) {
      const total = val.scores.length;
      if (total === 0) {
        result.push({
          fieldKey: key,
          referenceColumn: val.referenceColumn,
          inputColumn: val.inputColumn,
          totalEvaluated: 0,
          avgScore: 0,
          highCount: 0,
          medCount: 0,
          lowCount: 0,
          highPct: 0,
          medPct: 0,
          lowPct: 0,
        });
        continue;
      }

      let highCount = 0;
      let medCount = 0;
      let lowCount = 0;
      let sumScore = 0;

      for (const score of val.scores) {
        sumScore += score;
        if (score >= autoMatch) {
          highCount++;
        } else if (score >= reviewMin) {
          medCount++;
        } else {
          lowCount++;
        }
      }

      const avgScore = Math.round(sumScore / total);
      result.push({
        fieldKey: key,
        referenceColumn: val.referenceColumn,
        inputColumn: val.inputColumn,
        totalEvaluated: total,
        avgScore,
        highCount,
        medCount,
        lowCount,
        highPct: Math.round((highCount / total) * 100),
        medPct: Math.round((medCount / total) * 100),
        lowPct: Math.round((lowCount / total) * 100),
      });
    }

    return result.sort((a, b) => b.totalEvaluated - a.totalEvaluated);
  }, [items, columnMappings, autoMatch, reviewMin]);

  // 2. Compute Pareto Root-Cause Distribution for Review/Unmatched records
  const paretoStats = useMemo<ParetoStat[]>(() => {
    if (!items || items.length === 0) return [];

    const causeCounts: Record<string, number> = {
      "review.rootCause.legalConflict": 0,
      "review.rootCause.numericMismatch": 0,
      "review.rootCause.fieldConflict": 0,
      "review.rootCause.lowScore": 0,
      "review.rootCause.similarName": 0,
      "review.rootCause.noCandidate": 0,
      "review.rootCause.regionMismatch": 0,
      "review.rootCause.guardrailFailed": 0,
      "review.rootCause.other": 0,
    };

    let totalReviewCases = 0;

    for (const item of items) {
      if (item.status === "matched") continue;

      totalReviewCases++;
      const topCandidate = item.candidates?.[0];
      const evidence = topCandidate?.verification_evidence;
      const pattern = item.case_features?.pattern ?? "";
      const downgradeReason = (evidence?.downgrade_reason ?? "").toLowerCase();
      const decisionReason = (topCandidate?.decision_reason ?? "").toLowerCase();

      if (
        pattern === "LEGAL_FORM_CONFLICT" ||
        downgradeReason.includes("legal") ||
        decisionReason.includes("legal") ||
        downgradeReason.includes("badan usaha")
      ) {
        causeCounts["review.rootCause.legalConflict"]++;
      } else if (
        pattern === "NUMERIC_MISMATCH" ||
        downgradeReason.includes("numeric") ||
        decisionReason.includes("numeric") ||
        downgradeReason.includes("angka") ||
        downgradeReason.includes("nomor")
      ) {
        causeCounts["review.rootCause.numericMismatch"]++;
      } else if (
        pattern === "FIELD_CONFLICT" ||
        downgradeReason.includes("field") ||
        decisionReason.includes("field") ||
        downgradeReason.includes("atribut")
      ) {
        causeCounts["review.rootCause.fieldConflict"]++;
      } else if (
        downgradeReason.includes("region") ||
        downgradeReason.includes("wilayah") ||
        downgradeReason.includes("alamat") ||
        decisionReason.includes("wilayah")
      ) {
        causeCounts["review.rootCause.regionMismatch"]++;
      } else if (
        pattern === "SIMILAR_NAME_REVIEW" ||
        downgradeReason.includes("similar") ||
        decisionReason.includes("similar") ||
        downgradeReason.includes("mirip")
      ) {
        causeCounts["review.rootCause.similarName"]++;
      } else if (
        pattern === "LOW_CONFIDENCE_MATCH" ||
        (topCandidate && topCandidate.score < autoMatch)
      ) {
        causeCounts["review.rootCause.lowScore"]++;
      } else if (
        pattern === "NO_CANDIDATE" ||
        !topCandidate ||
        !topCandidate.reference_record_key
      ) {
        causeCounts["review.rootCause.noCandidate"]++;
      } else if (evidence?.downgraded) {
        causeCounts["review.rootCause.guardrailFailed"]++;
      } else {
        causeCounts["review.rootCause.other"]++;
      }
    }

    if (totalReviewCases === 0) return [];

    const sortedEntries = Object.entries(causeCounts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    let runningSum = 0;
    return sortedEntries.map(([key, count], index) => {
      runningSum += count;
      const percentage = Math.round((count / totalReviewCases) * 100);
      const cumulativePercentage = Math.round((runningSum / totalReviewCases) * 100);
      const isVitalFew = cumulativePercentage <= 80 || (index === 0 && cumulativePercentage > 80);

      return {
        id: key,
        labelKey: key,
        count,
        percentage,
        cumulativeCount: runningSum,
        cumulativePercentage,
        isVitalFew,
      };
    });
  }, [items, autoMatch]);

  const paretoChartData = useMemo(() => {
    return paretoStats.map((stat) => ({
      name: t(stat.labelKey as Parameters<typeof t>[0]),
      shortName: t(stat.labelKey as Parameters<typeof t>[0]).split("(")[0].trim(),
      count: stat.count,
      cumulativePct: stat.cumulativePercentage,
      percentage: stat.percentage,
    }));
  }, [paretoStats, t]);

  const vitalFewSummary = useMemo(() => {
    const vitalItems = paretoStats.filter((p) => p.isVitalFew);
    const vitalCount = vitalItems.length;
    const vitalPct = vitalItems.length > 0 ? vitalItems[vitalItems.length - 1].cumulativePercentage : 0;
    return { count: vitalCount, percent: vitalPct };
  }, [paretoStats]);

  if (!items || items.length === 0) return null;

  return (
    <Card className="overflow-hidden border-border bg-background shadow-xs transition-all">
      {/* Collapsible Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary/20 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg bg-brand/10 text-brand">
            <Activity className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t("review.diagnostics.title")}
              </h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand">
                <Sparkles className="size-3" />
                AI / Heuristic
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{t("review.diagnostics.desc")}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Sub-view switcher */}
          {isExpanded && (
            <div className="inline-flex rounded-lg border border-border bg-background p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab("heatmap")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${
                  activeTab === "heatmap"
                    ? "bg-brand text-brand-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Layers className="size-3.5" />
                {t("review.heatmap.title")}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("pareto")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${
                  activeTab === "pareto"
                    ? "bg-brand text-brand-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <TrendingUp className="size-3.5" />
                {t("review.pareto.title")}
              </button>
            </div>
          )}

          {/* Toggle Expand/Collapse */}
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-label={isExpanded ? t("review.diagnostics.collapse") : t("review.diagnostics.expand")}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="size-3.5" />
                <span className="hidden sm:inline">{t("review.diagnostics.collapse")}</span>
              </>
            ) : (
              <>
                <ChevronDown className="size-3.5" />
                <span className="hidden sm:inline">{t("review.diagnostics.expand")}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isExpanded && (
        <div className="p-4 sm:p-5">
          {activeTab === "heatmap" ? (
            /* ============================================================ */
            /* 1. QUALITY SUMMARY PER COLUMN (DYNAMIC THRESHOLDS)           */
            /* ============================================================ */
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-semibold text-foreground">
                    {t("review.heatmap.title")}
                  </h4>
                  <p className="text-[11px] text-muted-foreground">{t("review.heatmap.desc")}</p>
                </div>
                {/* Dynamic Quality Legend */}
                <div className="flex items-center gap-3 text-[11px] font-medium text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-xs bg-[#16a34a]" />
                    <span>{t("review.heatmap.highTier", { min: autoMatch })}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-xs bg-[#d97706]" />
                    <span>
                      {t("review.heatmap.medTier", {
                        min: reviewMin,
                        max: autoMatch > reviewMin ? autoMatch - 1 : autoMatch,
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-xs bg-[#dc2626]" />
                    <span>{t("review.heatmap.lowTier", { max: reviewMin })}</span>
                  </div>
                </div>
              </div>

              {fieldQualityStats.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  {t("review.heatmap.noMappedFields")}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {fieldQualityStats.map((stat) => {
                    const avgToneClass =
                      stat.avgScore >= autoMatch
                        ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                        : stat.avgScore >= reviewMin
                          ? "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30"
                          : "text-rose-700 dark:text-rose-400 bg-rose-500/10 border-rose-500/30";

                    return (
                      <div
                        key={stat.fieldKey}
                        className="flex flex-col justify-between rounded-xl border border-border bg-card p-3.5 shadow-2xs transition-all hover:border-brand/30 hover:shadow-xs"
                      >
                        <div>
                          {/* 1. Pasangan Kolom & Rata-rata Kemiripan */}
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="min-w-0 flex-1 space-y-1">
                              {/* Data Input */}
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                                  {t("review.heatmap.inputData")}
                                </span>
                                <p
                                  className="truncate text-xs font-semibold text-foreground"
                                  title={stat.inputColumn}
                                >
                                  {stat.inputColumn}
                                </p>
                              </div>

                              {/* Data Acuan */}
                              <div className="flex items-center gap-1.5 min-w-0 text-muted-foreground">
                                <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                                  {t("review.heatmap.referenceData")}
                                </span>
                                <p
                                  className="truncate text-[11px] font-medium"
                                  title={stat.referenceColumn}
                                >
                                  {stat.referenceColumn}
                                </p>
                              </div>
                            </div>

                            {/* 2. Rata-rata Kemiripan */}
                            <div className="flex shrink-0 flex-col items-end">
                              <span
                                className={`rounded-lg border px-2 py-0.5 text-xs font-bold tabular-nums shadow-2xs ${avgToneClass}`}
                              >
                                {stat.avgScore}%
                              </span>
                            </div>
                          </div>

                          {/* 3. Distribusi Tingkat Kemiripan */}
                          <div className="mt-3.5 space-y-1.5">
                            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary/80">
                              {stat.highPct > 0 && (
                                <div
                                  className="h-full bg-[#16a34a] transition-all"
                                  style={{ width: `${stat.highPct}%` }}
                                  title={`${t("review.heatmap.highTier", { min: autoMatch })}: ${stat.highCount} (${stat.highPct}%)`}
                                />
                              )}
                              {stat.medPct > 0 && (
                                <div
                                  className="h-full bg-[#d97706] transition-all"
                                  style={{ width: `${stat.medPct}%` }}
                                  title={`${t("review.heatmap.medTier", { min: reviewMin, max: autoMatch > reviewMin ? autoMatch - 1 : autoMatch })}: ${stat.medCount} (${stat.medPct}%)`}
                                />
                              )}
                              {stat.lowPct > 0 && (
                                <div
                                  className="h-full bg-[#dc2626] transition-all"
                                  style={{ width: `${stat.lowPct}%` }}
                                  title={`${t("review.heatmap.lowTier", { max: reviewMin })}: ${stat.lowCount} (${stat.lowPct}%)`}
                                />
                              )}
                            </div>

                            {/* Detailed Tier Count breakdown */}
                            <div className="flex items-center justify-between text-[10px] font-semibold tabular-nums">
                              <span className="text-emerald-600">
                                {stat.highPct}%{" "}
                                <span className="font-normal text-muted-foreground">
                                  ({stat.highCount})
                                </span>
                              </span>
                              <span className="text-amber-600">
                                {stat.medPct}%{" "}
                                <span className="font-normal text-muted-foreground">
                                  ({stat.medCount})
                                </span>
                              </span>
                              <span className="text-rose-600">
                                {stat.lowPct}%{" "}
                                <span className="font-normal text-muted-foreground">
                                  ({stat.lowCount})
                                </span>
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* 4. Jumlah Record yang Dievaluasi */}
                        <div className="mt-3.5 flex items-center justify-between border-t border-border/60 pt-2.5 text-[10px] text-muted-foreground">
                          <span>{t("review.heatmap.avgScore")}</span>
                          <span className="font-semibold text-foreground">
                            {t("review.heatmap.comparisons", { count: stat.totalEvaluated })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* ============================================================ */
            /* 2. PARETO ROOT-CAUSE BREAKDOWN                                */
            /* ============================================================ */
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-semibold text-foreground">
                    {t("review.pareto.title")}
                  </h4>
                  <p className="text-[11px] text-muted-foreground">{t("review.pareto.desc")}</p>
                </div>
                {vitalFewSummary.count > 0 && (
                  <div className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
                    <AlertTriangle className="size-3.5" />
                    <span>
                      {t("review.pareto.vitalFewDesc", {
                        count: vitalFewSummary.count,
                        percent: vitalFewSummary.percent,
                      })}
                    </span>
                  </div>
                )}
              </div>

              {paretoChartData.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  {t("review.pareto.noCauses")}
                </div>
              ) : (
                <div className="grid gap-6 lg:grid-cols-[1.8fr_1fr]">
                  {/* Composed Bar + Line Pareto Chart */}
                  <div className="rounded-lg border border-border bg-secondary/10 p-3 sm:p-4">
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={paretoChartData}
                          margin={{ top: 10, right: 20, bottom: 25, left: -10 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                          <XAxis
                            dataKey="shortName"
                            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                            interval={0}
                            angle={-15}
                            textAnchor="end"
                            height={35}
                          />
                          {/* Frequency Count Y-Axis (Left) */}
                          <YAxis
                            yAxisId="left"
                            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                            allowDecimals={false}
                          />
                          {/* Cumulative % Y-Axis (Right) */}
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            domain={[0, 100]}
                            ticks={[0, 20, 40, 60, 80, 100]}
                            tickFormatter={(v) => `${v}%`}
                            tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || payload.length === 0) return null;
                              const data = payload[0].payload as {
                                name: string;
                                count: number;
                                cumulativePct: number;
                                percentage: number;
                              };
                              return (
                                <div className="rounded-lg border border-border bg-background p-2.5 text-xs shadow-md">
                                  <p className="font-semibold text-foreground">{data.name}</p>
                                  <div className="mt-1 space-y-0.5 text-muted-foreground">
                                    <p>
                                      {t("review.pareto.cases")}:{" "}
                                      <span className="font-semibold text-foreground">
                                        {data.count} ({data.percentage}%)
                                      </span>
                                    </p>
                                    <p>
                                      {t("review.pareto.cumulative")}:{" "}
                                      <span className="font-semibold text-amber-600">
                                        {data.cumulativePct}%
                                      </span>
                                    </p>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          {/* 80% Pareto Reference Cutoff Line */}
                          <ReferenceLine
                            yAxisId="right"
                            y={80}
                            stroke="#dc2626"
                            strokeDasharray="4 4"
                            label={{
                              value: "80% Cutoff",
                              position: "insideTopRight",
                              fill: "#dc2626",
                              fontSize: 10,
                            }}
                          />
                          <Bar
                            yAxisId="left"
                            dataKey="count"
                            fill="var(--color-brand)"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={45}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="cumulativePct"
                            stroke="#d97706"
                            strokeWidth={2.5}
                            dot={{ r: 4, fill: "#d97706" }}
                            activeDot={{ r: 6 }}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Pareto Category Ranking List */}
                  <div className="space-y-2 overflow-y-auto max-h-72 pr-1">
                    {paretoStats.map((stat, idx) => (
                      <div
                        key={stat.id}
                        className={`rounded-lg border p-2.5 text-xs transition-colors ${
                          stat.isVitalFew
                            ? "border-warning/30 bg-warning/5 text-foreground"
                            : "border-border bg-secondary/15 text-muted-foreground"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-foreground">
                              {idx + 1}
                            </span>
                            <span className="truncate font-semibold text-foreground">
                              {t(stat.labelKey as Parameters<typeof t>[0])}
                            </span>
                          </div>
                          <span className="shrink-0 font-bold tabular-nums text-foreground">
                            {stat.count}{" "}
                            <span className="text-[10px] font-normal text-muted-foreground">
                              ({stat.percentage}%)
                            </span>
                          </span>
                        </div>

                        {/* Cumulative Progress Bar */}
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                            <div
                              className={`h-full rounded-full transition-all ${
                                stat.isVitalFew ? "bg-amber-500" : "bg-muted-foreground/50"
                              }`}
                              style={{ width: `${stat.cumulativePercentage}%` }}
                            />
                          </div>
                          <span className="shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground">
                            {stat.cumulativePercentage}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
