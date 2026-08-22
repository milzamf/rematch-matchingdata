import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Filter,
  Layers,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { Card } from "@/components/app-layout";
import type { ReviewCandidate, ReviewItem, VerificationEvidence, VerificationRuleEvaluated } from "@/lib/api";
import { usePreferences } from "@/lib/preferences";

export function VerificationEvidenceBadge({
  evidence,
  score,
}: {
  evidence?: VerificationEvidence | null;
  score?: number;
}) {
  const { t } = usePreferences();

  if (!evidence) {
    if (score !== undefined) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">
          {score}%
        </span>
      );
    }
    return null;
  }

  if (evidence.is_exact_match || evidence.bypassed_fuzzy) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
        <CheckCircle2 className="size-3.5" />
        {t("results.evidence.exactMatchLabel")}
      </span>
    );
  }

  if (evidence.downgraded) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2.5 py-1 text-xs font-semibold text-warning">
        <AlertTriangle className="size-3.5" />
        {t("results.evidence.downgraded")}
      </span>
    );
  }

  if (evidence.final_classification === "matched") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
        <ShieldCheck className="size-3.5" />
        {t("results.evidence.verified")}
      </span>
    );
  }

  if (evidence.final_classification === "possible_match") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-brand/15 px-2.5 py-1 text-xs font-semibold text-brand">
        <Layers className="size-3.5" />
        {t("results.metric.review")} ({evidence.weighted_similarity}%)
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">
      {t("results.metric.unmatched")} ({evidence.weighted_similarity}%)
    </span>
  );
}

export function VerificationEvidenceBreakdown({
  evidence,
  candidate,
}: {
  evidence?: VerificationEvidence | null;
  candidate?: ReviewCandidate | null;
}) {
  const { t } = usePreferences();
  const [expanded, setExpanded] = useState(true);

  const ev = evidence ?? candidate?.verification_evidence;

  if (!ev) {
    return (
      <div className="rounded-lg border border-border bg-secondary/10 p-3 text-xs text-muted-foreground">
        {candidate?.decision_reason || t("results.evidence.exactMatchLabel")}
      </div>
    );
  }

  const isExact = ev.is_exact_match || ev.bypassed_fuzzy;
  const rules = ev.rules_evaluated ?? [];

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-foreground">
            {t("results.evidence.title")}
          </span>
          <span className="rounded bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground border border-border">
            {ev.phase}
          </span>
          <VerificationEvidenceBadge evidence={ev} />
        </div>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <>
              <span>Collapse</span>
              <ChevronUp className="size-3.5" />
            </>
          ) : (
            <>
              <span>Expand</span>
              <ChevronDown className="size-3.5" />
            </>
          )}
        </button>
      </div>

      {expanded && (
        <div className="space-y-4 p-4 text-xs">
          {/* Metadata Cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-border bg-secondary/20 p-2.5">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("results.evidence.initialClassification")}
              </span>
              <p className="mt-1 font-semibold capitalize text-foreground">
                {ev.initial_classification.replace("_", " ")}
              </p>
            </div>
            <div className="rounded-md border border-border bg-secondary/20 p-2.5">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("results.evidence.finalClassification")}
              </span>
              <p className="mt-1 font-semibold capitalize text-foreground">
                {ev.final_classification.replace("_", " ")}
              </p>
            </div>
            <div className="rounded-md border border-border bg-secondary/20 p-2.5">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("results.evidence.weightedSimilarity")}
              </span>
              <p className="mt-1 font-semibold tabular-nums text-foreground">
                {isExact ? t("results.evidence.exactMatchLabel") : `${ev.weighted_similarity}%`}
              </p>
            </div>
            <div className="rounded-md border border-border bg-secondary/20 p-2.5">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("results.evidence.rulesEvaluated")}
              </span>
              <p className="mt-1 font-semibold tabular-nums text-foreground">
                {isExact ? "Bypassed (0 rules)" : `${ev.summary?.passed_rules ?? 0} / ${ev.summary?.total_rules ?? rules.length} passed`}
              </p>
            </div>
          </div>

          {/* Downgrade alert banner */}
          {ev.downgraded && (
            <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 p-3 text-warning">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-xs">{t("results.evidence.downgraded")}</p>
                <p className="mt-0.5 text-xs text-foreground/90 font-medium">
                  {ev.downgrade_reason || candidate?.decision_reason}
                </p>
              </div>
            </div>
          )}

          {/* Rules Evaluated Table */}
          {rules.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">{t("results.evidence.rule")}</th>
                    <th className="px-3 py-2 font-medium">{t("results.evidence.method")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("results.evidence.threshold")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("results.evidence.actual")}</th>
                    <th className="px-3 py-2 text-center font-medium">{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rules.map((rule, idx) => (
                    <tr
                      key={`${rule.order}-${rule.field_name}-${idx}`}
                      className={rule.passed ? "hover:bg-secondary/15" : "bg-destructive/5 hover:bg-destructive/10"}
                    >
                      <td className="px-3 py-2 font-medium tabular-nums text-muted-foreground">
                        {rule.order}
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>{rule.field_name}</span>
                          {rule.is_mandatory && (
                            <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                              {t("results.evidence.mandatory")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{rule.method}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground font-medium">
                        = {rule.required_threshold}%
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        <span className={rule.passed ? "text-success" : "text-destructive"}>
                          {rule.actual_score}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {rule.passed ? (
                          <span className="inline-flex items-center gap-1 rounded bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                            <CheckCircle2 className="size-3" />
                            {t("results.evidence.passed")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                            <XCircle className="size-3" />
                            {t("results.evidence.failed")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {isExact && (
            <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-success">
              <CheckCircle2 className="size-4 shrink-0" />
              <p className="text-xs">
                {ev.summary?.message || "Exact match on all mandatory fields bypassed fuzzy candidate scoring and guardrail checks."}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type AggregatedRuleDiagnostic = {
  fieldName: string;
  method: string;
  totalEvaluated: number;
  failCount: number;
  passCount: number;
  failPercentage: number;
  passPercentage: number;
  downgradeCount: number;
  failedItemKeys: string[];
};

export function ExploratoryDiagnosticsPanel({
  items,
  onFilterRule,
  selectedRuleFilter,
}: {
  items: ReviewItem[];
  onFilterRule?: (fieldName: string | null) => void;
  selectedRuleFilter?: string | null;
}) {
  const { t } = usePreferences();

  const diagnostics = useMemo(() => {
    const ruleMap = new Map<string, {
      fieldName: string;
      method: string;
      totalEvaluated: number;
      failCount: number;
      passCount: number;
      downgradeCount: number;
      failedItemKeys: Set<string>;
    }>();

    let totalExactMatches = 0;
    let totalAutoMatches = 0;
    let totalDowngraded = 0;
    let totalNeedReview = 0;
    let totalUnmatched = 0;

    for (const item of items) {
      const candidate = item.candidates?.[0];
      const evidence = candidate?.verification_evidence;

      if (evidence?.is_exact_match || evidence?.bypassed_fuzzy) {
        totalExactMatches += 1;
      } else if (item.status === "matched") {
        totalAutoMatches += 1;
      }

      if (evidence?.downgraded) {
        totalDowngraded += 1;
      }

      if (item.status === "possible_match") {
        totalNeedReview += 1;
      } else if (item.status === "unmatched") {
        totalUnmatched += 1;
      }

      if (evidence?.rules_evaluated) {
        for (const rule of evidence.rules_evaluated) {
          const key = rule.field_name;
          let entry = ruleMap.get(key);
          if (!entry) {
            entry = {
              fieldName: rule.field_name,
              method: rule.method,
              totalEvaluated: 0,
              failCount: 0,
              passCount: 0,
              downgradeCount: 0,
              failedItemKeys: new Set<string>(),
            };
            ruleMap.set(key, entry);
          }

          entry.totalEvaluated += 1;
          if (rule.passed) {
            entry.passCount += 1;
          } else {
            entry.failCount += 1;
            entry.failedItemKeys.add(item.input_record_key);
            if (evidence.downgraded) {
              entry.downgradeCount += 1;
            }
          }
        }
      }
    }

    const totalFailuresAcrossRules = Array.from(ruleMap.values()).reduce(
      (sum, r) => sum + r.failCount,
      0,
    );

    const sortedRules: AggregatedRuleDiagnostic[] = Array.from(ruleMap.values())
      .map((r) => ({
        fieldName: r.fieldName,
        method: r.method,
        totalEvaluated: r.totalEvaluated,
        failCount: r.failCount,
        passCount: r.passCount,
        failPercentage:
          r.totalEvaluated > 0 ? Math.round((r.failCount / r.totalEvaluated) * 100) : 0,
        passPercentage:
          r.totalEvaluated > 0 ? Math.round((r.passCount / r.totalEvaluated) * 100) : 100,
        downgradeCount: r.downgradeCount,
        failedItemKeys: Array.from(r.failedItemKeys),
      }))
      .sort((a, b) => b.failCount - a.failCount);

    return {
      totalExactMatches,
      totalAutoMatches,
      totalDowngraded,
      totalNeedReview,
      totalUnmatched,
      totalFailuresAcrossRules,
      rules: sortedRules,
    };
  }, [items]);

  const maxFailCount = Math.max(1, ...diagnostics.rules.map((r) => r.failCount));

  return (
    <div className="space-y-6 p-6">
      {/* Header & High-level Metrics */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="size-5 text-brand" />
            {t("results.exploratory.title")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("results.exploratory.desc")}
          </p>
        </div>

        {selectedRuleFilter && (
          <button
            type="button"
            onClick={() => onFilterRule?.(null)}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20 transition-colors"
          >
            <Filter className="size-3.5" />
            <span>{t("results.exploratory.clearFilter")}: {selectedRuleFilter}</span>
          </button>
        )}
      </div>

      {/* Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="p-4 border-border">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("results.summary.total")}
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">
            {items.length}
          </p>
        </Card>

        <Card className="p-4 border-border border-l-4 border-l-success">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("results.summary.exactMatched")}
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-success">
            {diagnostics.totalExactMatches}
          </p>
        </Card>

        <Card className="p-4 border-border border-l-4 border-l-brand">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("results.summary.fuzzyMatched")}
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-brand">
            {diagnostics.totalAutoMatches}
          </p>
        </Card>

        <Card className="p-4 border-border border-l-4 border-l-warning">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("results.evidence.downgraded")}
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-warning">
            {diagnostics.totalDowngraded}
          </p>
        </Card>

        <Card className="p-4 border-border border-l-4 border-l-destructive">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("results.summary.finalUnmatched")}
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-destructive">
            {diagnostics.totalUnmatched}
          </p>
        </Card>
      </div>

      {/* Problem Pattern Analysis: Pareto Distribution */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              {t("results.exploratory.paretoTitle")}
            </h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Click a bar to filter records that failed that specific guardrail
            </p>
          </div>
          <span className="rounded-md bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            {diagnostics.rules.filter((r) => r.failCount > 0).length} Failed Rules
          </span>
        </div>

        {diagnostics.rules.filter((r) => r.failCount > 0).length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            <CheckCircle2 className="mx-auto size-8 text-success mb-2" />
            {t("results.exploratory.noFailures")}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {diagnostics.rules
              .filter((r) => r.failCount > 0)
              .map((rule) => {
                const isSelected = selectedRuleFilter === rule.fieldName;
                const widthPercent = Math.max(8, Math.round((rule.failCount / maxFailCount) * 100));

                return (
                  <div
                    key={rule.fieldName}
                    onClick={() => onFilterRule?.(isSelected ? null : rule.fieldName)}
                    className={[
                      "group cursor-pointer rounded-lg border p-3 transition-all",
                      isSelected
                        ? "border-brand bg-brand/5 ring-1 ring-brand"
                        : "border-border hover:border-brand/40 hover:bg-secondary/20",
                    ].join(" ")}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">
                          {rule.fieldName}
                        </span>
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {rule.method}
                        </span>
                        {rule.downgradeCount > 0 && (
                          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                            {rule.downgradeCount} Auto-Match Downgrades
                          </span>
                        )}
                      </div>
                      <div className="font-semibold tabular-nums text-foreground">
                        <span className="text-destructive">{rule.failCount} failed</span>
                        <span className="text-muted-foreground text-[11px] ml-1.5">
                          ({rule.failPercentage}% fail rate)
                        </span>
                      </div>
                    </div>

                    {/* Progress / Pareto Bar */}
                    <div className="mt-2.5 h-3 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className={[
                          "h-full rounded-full transition-all",
                          isSelected ? "bg-brand" : "bg-destructive/80 group-hover:bg-destructive",
                        ].join(" ")}
                        style={{ width: `${widthPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </Card>

      {/* Rule Effectiveness & Pass Rates Table */}
      <Card className="overflow-hidden">
        <div className="border-b border-border bg-secondary/30 px-5 py-3">
          <h4 className="text-sm font-semibold text-foreground">
            {t("results.exploratory.ruleEffectiveness")}
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("results.evidence.rule")}</th>
                <th className="px-5 py-3 font-medium">{t("results.evidence.method")}</th>
                <th className="px-5 py-3 text-right font-medium">Evaluations</th>
                <th className="px-5 py-3 text-right font-medium text-success">Passed</th>
                <th className="px-5 py-3 text-right font-medium text-destructive">Failed</th>
                <th className="px-5 py-3 text-right font-medium">{t("results.exploratory.passRate")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {diagnostics.rules.map((rule) => (
                <tr key={rule.fieldName} className="hover:bg-secondary/20">
                  <td className="px-5 py-3 font-semibold text-foreground">{rule.fieldName}</td>
                  <td className="px-5 py-3 text-muted-foreground">{rule.method}</td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums text-foreground">
                    {rule.totalEvaluated}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-success">
                    {rule.passCount}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-destructive">
                    {rule.failCount}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className="font-bold tabular-nums text-foreground">
                      {rule.passPercentage}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
