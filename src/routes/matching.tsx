import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { AppLayout, PageHeader, Card } from "@/components/app-layout";
import { Stepper } from "@/components/stepper";
import { EmptyState } from "@/components/empty-state";
import { wizardSteps, columnProfile, reviewQueue, synchronizationSummary } from "@/lib/dummy-data";
import {
  Check,
  Upload,
  FileSpreadsheet,
  Database,
  ArrowRight,
  ArrowLeft,
  Play,
  Loader2,
  AlertCircle,
  ClipboardCheck,
  X,
  Sparkles,
  ChevronDown,
  Search,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";


export const Route = createFileRoute("/matching")({
  head: () => ({
    meta: [
      { title: "Matching Workflow — BatchMatch" },
      {
        name: "description",
        content:
          "Step-by-step matching workflow: upload datasets, profile columns, configure rules, run, review, synchronize, and export results.",
      },
    ],
  }),
  component: MatchingPage,
});

type UploadedFile = { name: string; size: number };
type RunState = "idle" | "running" | "success" | "failed";

const ALLOWED = [".csv", ".xlsx", ".xls", ".xml", ".dbf"];
const MAX_MB = 50;

function MatchingPage() {
  const [step, setStep] = useState(1);
  const [reference, setReference] = useState<UploadedFile | null>(null);
  const [input, setInput] = useState<UploadedFile | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [runState, setRunState] = useState<RunState>("idle");
  const [progress, setProgress] = useState(0);

  const canAdvance = step !== 1 || (reference && input);

  const startRun = () => {
    setRunState("running");
    setProgress(0);
    const shouldFail = Math.random() < 0.15;
    const iv = window.setInterval(() => {
      setProgress((p) => {
        const next = p + 8 + Math.random() * 6;
        if (next >= 100) {
          window.clearInterval(iv);
          setRunState(shouldFail ? "failed" : "success");
          return 100;
        }
        return next;
      });
    }, 300);
  };

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-[1400px] mx-auto">
        <PageHeader
          title="New Matching Job"
          description="One continuous workflow — upload, configure, run, review, synchronize, and export."
        />

        {/* Horizontal stepper */}
        <Card className="p-5 mb-6 sticky top-16 z-10">
          <Stepper steps={wizardSteps} current={step} onSelect={setStep} />
        </Card>

        <Card className="p-6">
          {step === 1 && (
            <StepUpload
              reference={reference}
              input={input}
              setReference={setReference}
              setInput={setInput}
              error={uploadError}
              setError={setUploadError}
            />
          )}
          {step === 2 && <StepProfile />}
          {step === 3 && <StepMapping />}
          {step === 4 && <StepConfig />}
          {step === 5 && (
            <StepRun
              state={runState}
              progress={progress}
              onStart={startRun}
              onRetry={() => {
                setRunState("idle");
                setProgress(0);
              }}
              onBack={() => setStep(4)}
            />
          )}
          {step === 6 && <StepReview />}
          {step === 7 && <StepSynchronize />}
          {step === 8 && <StepExport />}

          {/* Nav */}
          <div className="flex items-center justify-between pt-6 mt-6 border-t border-border">
            <button
              disabled={step === 1}
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ArrowLeft className="size-4" />
              Back
            </button>
            <p className="text-xs text-muted-foreground">
              Step {step} of {wizardSteps.length}
            </p>
            {step === wizardSteps.length ? (
              <Link
                to="/results"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand text-brand-foreground hover:opacity-90"
              >
                Go to Results
                <ArrowRight className="size-4" />
              </Link>
            ) : (
              <button
                disabled={!canAdvance}
                onClick={() => setStep((s) => Math.min(wizardSteps.length, s + 1))}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand text-brand-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue
                <ArrowRight className="size-4" />
              </button>
            )}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}

function SectionTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}

function validateFile(file: File): string | null {
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  if (!ALLOWED.includes(ext)) return `Unsupported format. Allowed: ${ALLOWED.join(", ")}`;
  if (file.size > MAX_MB * 1024 * 1024) return `File exceeds ${MAX_MB}MB limit.`;
  return null;
}

function StepUpload({
  reference,
  input,
  setReference,
  setInput,
  error,
  setError,
}: {
  reference: UploadedFile | null;
  input: UploadedFile | null;
  setReference: (f: UploadedFile | null) => void;
  setInput: (f: UploadedFile | null) => void;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  return (
    <>
      <SectionTitle
        title="Upload Dataset"
        desc="Provide your reference (master) file and the input file to match against."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FileSlot
          label="Reference File"
          hint="Master dataset (customer_master, vendors, etc.)"
          icon={Database}
          file={reference}
          onFile={(f) => {
            const err = validateFile(f);
            if (err) return setError(err);
            setError(null);
            setReference({ name: f.name, size: f.size });
          }}
          onClear={() => setReference(null)}
        />
        <FileSlot
          label="Input File"
          hint="File to reconcile against the reference"
          icon={FileSpreadsheet}
          file={input}
          onFile={(f) => {
            const err = validateFile(f);
            if (err) return setError(err);
            setError(null);
            setInput({ name: f.name, size: f.size });
          }}
          onClear={() => setInput(null)}
        />
      </div>
      {error && (
        <div className="mt-4 flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
          <AlertCircle className="size-3.5" />
          {error}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground bg-secondary/40 rounded-md px-3 py-2">
        <Upload className="size-3.5" />
        Accepted: {ALLOWED.join(", ")} · Max {MAX_MB} MB · UTF-8 recommended.
      </div>
    </>
  );
}

function FileSlot({
  label,
  hint,
  icon: Icon,
  file,
  onFile,
  onClear,
}: {
  label: string;
  hint: string;
  icon: typeof Database;
  file: UploadedFile | null;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="border border-dashed border-border rounded-lg p-6 hover:border-accent/50 hover:bg-secondary/30 transition-colors">
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept={ALLOWED.join(",")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex items-start gap-3">
        <div className="size-10 rounded-lg bg-secondary grid place-items-center">
          <Icon className="size-5 text-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{label}</p>
          {file ? (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
          )}
        </div>
        {file ? (
          <button onClick={onClear} className="text-muted-foreground hover:text-destructive">
            <X className="size-4" />
          </button>
        ) : (
          <Check className="size-4 text-muted-foreground/30" />
        )}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{file ? "Uploaded" : "No file"}</span>
        <button
          onClick={() => ref.current?.click()}
          className="font-medium text-accent hover:underline"
        >
          {file ? "Replace" : "Choose file"}
        </button>
      </div>
    </div>
  );
}

function StepProfile() {
  return (
    <>
      <SectionTitle
        title="Data Profiling"
        desc="Review inferred column types, quality, and detected patterns before mapping."
      />
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40">
            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-2.5 font-medium">Column</th>
              <th className="text-left px-4 py-2.5 font-medium">Type</th>
              <th className="text-left px-4 py-2.5 font-medium">Nulls</th>
              <th className="text-left px-4 py-2.5 font-medium">Unique</th>
              <th className="text-left px-4 py-2.5 font-medium">Pattern</th>
              <th className="text-left px-4 py-2.5 font-medium">Flag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {columnProfile.map((c) => (
              <tr key={c.name} className="hover:bg-secondary/30">
                <td className="px-4 py-3 font-mono text-xs">{c.name}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex text-[10px] font-mono bg-secondary rounded px-1.5 py-0.5">
                    {c.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs tabular-nums">{c.nulls}</td>
                <td className="px-4 py-3 text-xs tabular-nums">{c.unique}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{c.pattern}</td>
                <td className="px-4 py-3 text-xs text-accent">{c.flag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StepMapping() {
  const mappings = [
    { ref: "customer_id", input: "cust_id", method: "Exact" },
    { ref: "company_name", input: "account_name", method: "Fuzzy — Token Sort" },
    { ref: "npwp", input: "tax_id", method: "Exact (Strict)" },
    { ref: "address", input: "billing_address", method: "Address Normalize + TF-IDF" },
    { ref: "email", input: "email_primary", method: "Normalized Exact" },
  ];
  return (
    <>
      <SectionTitle
        title="Column Mapping"
        desc="Link reference columns to input columns and choose a comparison method for each pair."
      />
      <div className="space-y-2.5 overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px] items-center gap-4 px-4 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Reference Column</span>
          <span>Input Column</span>
          <span>Matching Algorithm</span>
        </div>
        {mappings.map((m) => (
          <div
            key={m.ref}
            className="grid min-w-[760px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px] items-center gap-4 border border-border rounded-lg px-4 py-3"
          >
            <p className="truncate rounded-md bg-secondary/50 px-3 py-2 text-sm font-mono">{m.ref}</p>
            <p className="truncate rounded-md bg-secondary/50 px-3 py-2 text-sm font-mono">{m.input}</p>
            <span className="inline-flex h-9 items-center justify-center rounded-md bg-secondary px-2 py-1 text-center text-[11px] font-medium">
              {m.method}
            </span>
          </div>
        ))}
        <button className="w-full py-3 border border-dashed border-border rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors">
          + Add column mapping
        </button>
      </div>
    </>
  );
}


type Preset = "Balanced" | "Strict" | "Exploratory" | "Custom";
type Strategy = "Hybrid" | "Exact" | "Fuzzy" | "Composite" | "Rule-Based";

const PRESET_DEFAULTS: Record<Preset, { autoMatch: number; review: number; noMatch: number; strategy: Strategy }> = {
  Balanced:    { autoMatch: 90, review: 75, noMatch: 60, strategy: "Hybrid" },
  Strict:      { autoMatch: 95, review: 85, noMatch: 70, strategy: "Exact" },
  Exploratory: { autoMatch: 85, review: 65, noMatch: 50, strategy: "Fuzzy" },
  Custom:      { autoMatch: 90, review: 75, noMatch: 60, strategy: "Hybrid" },
};

function StepConfig() {
  const [preset, setPreset] = useState<Preset>("Balanced");
  const [strategy, setStrategy] = useState<Strategy>("Hybrid");
  const [autoMatch, setAutoMatch] = useState(90);
  const [review, setReview] = useState(75);
  const [noMatch, setNoMatch] = useState(60);
  const [searchMode, setSearchMode] = useState<"auto" | "manual">("auto");
  const [manualBlocks, setManualBlocks] = useState<string[]>(["company_name", "npwp"]);
  const [candidates, setCandidates] = useState<1 | 3 | 5 | 10>(3);
  const [outputs, setOutputs] = useState<string[]>([
    "Matched",
    "Possible Match",
    "Unmatched",
    "Synchronization Summary",
    "Summary Report",
  ]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [weights, setWeights] = useState([
    { field: "company_name", weight: 45, method: "Token Sort Ratio" },
    { field: "npwp", weight: 30, method: "Exact Strict" },
    { field: "address", weight: 15, method: "TF-IDF Cosine" },
    { field: "email", weight: 10, method: "Normalized Exact" },
  ]);
  const [norm, setNorm] = useState<Record<string, boolean>>({
    Lowercase: true,
    "Trim Spaces": true,
    "Remove Punctuation": true,
    "Ignore Legal Entity (PT, CV, Ltd, Inc)": true,
    "Normalize Address": true,
    "Normalize Phone Number": false,
    "Normalize Date Format": false,
  });

  const isCustom = preset === "Custom";
  const totalWeight = weights.reduce((s, w) => s + w.weight, 0);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const d = PRESET_DEFAULTS[p];
    setAutoMatch(d.autoMatch);
    setReview(d.review);
    setNoMatch(d.noMatch);
    setStrategy(d.strategy);
  };

  const AUTO_RECOMMEND_KEYS = ["Company Name Prefix", "NPWP", "Email Domain", "Postal Code"];
  const AVAILABLE_COLUMNS = ["customer_id", "company_name", "npwp", "address", "phone", "email", "city", "postal_code"];

  const applyRecommendation = () => {
    setStrategy("Hybrid");
    applyPreset("Balanced");
    setSearchMode("auto");
  };

  return (
    <>
      <SectionTitle
        title="Matching Configuration"
        desc="Tune presets, strategy, thresholds, search optimization and outputs. Advanced controls are collapsed."
      />

      {/* Smart Recommendation */}
      <div className="border border-accent/30 bg-accent/5 rounded-lg p-5 mb-6">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-accent/15 text-accent grid place-items-center shrink-0">
            <Sparkles className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">Recommended Configuration</p>
              <span className="text-[10px] font-semibold bg-accent/15 text-accent rounded-full px-1.5 py-0.5">
                Confidence 96%
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                ["Strategy", "Hybrid"],
                ["Preset", "Balanced"],
                ["Search Optimization", "Company Name Prefix"],
                ["Normalization", "Entity Name"],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p>
                  <p className="text-sm font-medium mt-0.5">{v}</p>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={applyRecommendation}
            className="shrink-0 px-3 py-2 rounded-md bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90"
          >
            Apply Recommendation
          </button>
        </div>
      </div>

      {/* 1. Preset */}
      <ConfigSection title="Preset" desc="Templates that set thresholds, strategy and normalization together.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {(["Balanced", "Strict", "Exploratory", "Custom"] as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={[
                "px-3 py-2 rounded-md border text-sm font-medium",
                preset === p
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary",
              ].join(" ")}
            >
              {p}
            </button>
          ))}
        </div>
      </ConfigSection>

      {/* 2. Strategy */}
      <ConfigSection title="Matching Strategy" desc="Select how records are compared.">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {([
            ["Hybrid", "Recommended"],
            ["Exact", "Exact Match"],
            ["Fuzzy", "Fuzzy Match"],
            ["Composite", "Composite"],
            ["Rule-Based", "Rule-Based"],
          ] as [Strategy, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setStrategy(key);
                if (!isCustom) setPreset("Custom");
              }}
              className={[
                "px-3 py-2 rounded-md border text-sm font-medium",
                strategy === key
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </ConfigSection>

      {/* 3. Similarity Threshold */}
      <ConfigSection title="Similarity Threshold" desc={`Preset "${preset}" recommends the values below.`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ThresholdInput label="Auto Match" tone="success" value={autoMatch} onChange={setAutoMatch} />
          <ThresholdInput label="Manual Review" tone="warning" value={review} onChange={setReview} />
          <ThresholdInput label="No Match" tone="muted" value={noMatch} onChange={setNoMatch} />
        </div>
      </ConfigSection>

      {/* 4. Search Optimization */}
      <ConfigSection title="Search Optimization" desc="Narrow candidate pairs before scoring.">
        <div className="flex gap-2 mb-3">
          {(["auto", "manual"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setSearchMode(m)}
              className={[
                "px-3 py-1.5 rounded-md border text-xs font-medium",
                searchMode === m
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary",
              ].join(" ")}
            >
              {m === "auto" ? "Auto Recommend" : "Manual Candidate Strategy"}
            </button>
          ))}
        </div>
        {searchMode === "auto" ? (
          <div className="border border-border rounded-lg p-4 bg-secondary/30">
            <p className="text-xs text-muted-foreground mb-2">
              Based on the uploaded dataset, BatchMatch recommends:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {AUTO_RECOMMEND_KEYS.map((k) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 rounded-md bg-accent/10 text-accent px-2 py-1 text-xs font-medium"
                >
                  <Sparkles className="size-3" />
                  {k}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {AVAILABLE_COLUMNS.map((c) => {
              const on = manualBlocks.includes(c);
              return (
                <button
                  key={c}
                  onClick={() =>
                    setManualBlocks((prev) => (on ? prev.filter((x) => x !== c) : [...prev, c]))
                  }
                  className={[
                    "px-3 py-1.5 rounded-md border text-xs font-mono text-left",
                    on
                      ? "border-brand bg-brand/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary",
                  ].join(" ")}
                >
                  {c}
                </button>
              );
            })}
          </div>
        )}
      </ConfigSection>

      {/* 5. Data Normalization */}
      <ConfigSection title="Data Normalization" desc="Clean values before comparison.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.keys(norm).map((k) => (
            <label
              key={k}
              className="flex items-center gap-2.5 border border-border rounded-md px-3 py-2 cursor-pointer hover:bg-secondary/30"
            >
              <input
                type="checkbox"
                checked={norm[k]}
                onChange={(e) => setNorm((prev) => ({ ...prev, [k]: e.target.checked }))}
                className="size-3.5 accent-brand"
              />
              <span className="text-xs">{k}</span>
            </label>
          ))}
        </div>
      </ConfigSection>

      {/* 6. Candidate Generation */}
      <ConfigSection title="Candidate Generation" desc="How many candidates per input record.">
        <div className="grid grid-cols-4 gap-2 max-w-md">
          {([1, 3, 5, 10] as const).map((n) => (
            <button
              key={n}
              onClick={() => setCandidates(n)}
              className={[
                "px-3 py-2 rounded-md border text-sm font-medium tabular-nums",
                candidates === n
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary",
              ].join(" ")}
            >
              Top {n}
            </button>
          ))}
        </div>
      </ConfigSection>

      {/* 7. Output Configuration */}
      <ConfigSection
        title="Output Configuration"
        desc="Choose export contents and include the synchronization plan selected in the Sync step."
      >
        <div className="mb-4 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
            <div>
              <p className="text-sm font-semibold">Merge strategy will be included</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Export files will record whether matched records were dropped, unmatched records were appended,
                and conflicts were sent to review.
              </p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {["Matched", "Possible Match", "Unmatched", "Synchronization Summary", "Mapping Table", "Foreign Key", "Audit Trail", "Summary Report"].map(
            (o) => {
              const on = outputs.includes(o);
              return (
                <label
                  key={o}
                  className="flex items-center gap-2.5 border border-border rounded-md px-3 py-2 cursor-pointer hover:bg-secondary/30"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setOutputs((prev) => (on ? prev.filter((x) => x !== o) : [...prev, o]))
                    }
                    className="size-3.5 accent-brand"
                  />
                  <span className="text-xs">{o}</span>
                </label>
              );
            },
          )}
        </div>
      </ConfigSection>

      {/* 8. Advanced */}
      <div className="border border-border rounded-lg mb-2">
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left"
        >
          <div>
            <p className="text-sm font-semibold">Advanced Settings</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Field weights, per-column algorithms, tolerances. Most users don't need this.
            </p>
          </div>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${advancedOpen ? "rotate-180" : ""}`}
          />
        </button>
        {advancedOpen && (
          <div className="border-t border-border px-5 py-5 space-y-5">
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">Field Weights</p>
                <p
                  className={`text-xs font-medium tabular-nums ${
                    totalWeight === 100 ? "text-success" : "text-destructive"
                  }`}
                >
                  Total: {totalWeight}%
                </p>
              </div>
              <div className="space-y-3">
                {weights.map((w, i) => (
                  <div key={w.field} className="grid grid-cols-[160px_1fr_50px] items-center gap-4">
                    <div>
                      <p className="text-sm font-mono truncate">{w.field}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{w.method}</p>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={w.weight}
                      onChange={(e) =>
                        setWeights((prev) => {
                          const next = [...prev];
                          next[i] = { ...next[i], weight: Number(e.target.value) };
                          return next;
                        })
                      }
                      className="w-full accent-brand"
                    />
                    <p className="text-sm font-semibold tabular-nums text-right">{w.weight}%</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                ["Mandatory Rules", "NPWP must match exactly when present"],
                ["Numeric Tolerance", "± 0.5%"],
                ["Date Tolerance", "± 3 days"],
                ["Similarity Formula", "Weighted average (default)"],
              ].map(([k, v]) => (
                <div key={k} className="border border-border rounded-md px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p>
                  <p className="text-xs font-medium mt-0.5">{v}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function ConfigSection({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-border rounded-lg p-5 mb-4">
      <div className="mb-4">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      {children}
    </section>
  );
}

function ThresholdInput({
  label,
  tone,
  value,
  onChange,
}: {
  label: string;
  tone: "success" | "warning" | "muted";
  value: number;
  onChange: (n: number) => void;
}) {
  const color =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-muted-foreground";
  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <span className={`text-sm font-semibold tabular-nums ${color}`}>≥ {value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand"
      />
    </div>
  );
}


function StepRun({
  state,
  progress,
  onStart,
  onRetry,
  onBack,
}: {
  state: RunState;
  progress: number;
  onStart: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <>
      <SectionTitle
        title="Run Matching"
        desc="Execute the job with your current configuration and monitor progress."
      />
      {state === "idle" && (
        <div className="border border-border rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-secondary grid place-items-center">
                <Play className="size-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">Ready to run</p>
                <p className="text-xs text-muted-foreground">
                  Estimated: ~1.2M pairwise comparisons · 2–3 minutes
                </p>
              </div>
            </div>
            <button
              onClick={onStart}
              className="px-4 py-2 rounded-md bg-brand text-brand-foreground text-sm font-semibold hover:opacity-90"
            >
              Start Matching
            </button>
          </div>
        </div>
      )}

      {state === "running" && (
        <div className="border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <Loader2 className="size-5 text-accent animate-spin" />
            <div>
              <p className="text-sm font-semibold">Matching in progress…</p>
              <p className="text-xs text-muted-foreground">
                {progress < 40
                  ? "Building candidate pairs"
                  : progress < 80
                    ? "Scoring comparisons"
                    : "Finalizing results"}
              </p>
            </div>
          </div>
          <div className="flex justify-between text-xs mb-2">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-medium tabular-nums">{Math.round(progress)}%</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {state === "success" && (
        <div className="border border-success/30 bg-success/5 rounded-lg p-6 flex items-start gap-4">
          <div className="size-10 rounded-full bg-success/10 grid place-items-center">
            <Check className="size-5 text-success" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">Matching complete</p>
            <p className="text-xs text-muted-foreground mt-1">
              12,482 matched · 842 possible · 45 unmatched. Move to Manual Review next.
            </p>
          </div>
        </div>
      )}

      {state === "failed" && (
        <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-6 flex items-start gap-4">
          <div className="size-10 rounded-full bg-destructive/10 grid place-items-center">
            <AlertCircle className="size-5 text-destructive" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">Matching failed</p>
            <p className="text-xs text-muted-foreground mt-1">
              A worker error stopped the job at {Math.round(progress)}%. No results were written.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={onRetry}
                className="px-3 py-1.5 rounded-md bg-brand text-brand-foreground text-xs font-semibold"
              >
                Retry
              </button>
              <button
                onClick={onBack}
                className="px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-secondary"
              >
                Back to configuration
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type ReviewRow = (typeof reviewQueue)[number];

function StepReview() {
  const [items, setItems] = useState(reviewQueue);
  const [query, setQuery] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 8;

  const filtered = items
    .filter(
      (r) =>
        !query ||
        r.refName.toLowerCase().includes(query.toLowerCase()) ||
        r.inputName.toLowerCase().includes(query.toLowerCase()) ||
        r.id.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => (sortDesc ? b.score - a.score : a.score - b.score));

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const paged = filtered.slice((page - 1) * perPage, page * perPage);

  const decide = (id: string) => {
    setItems((prev) => prev.filter((p) => p.id !== id));
    setSelected(null);
  };

  const recommendation = (score: number) =>
    score >= 90 ? "Approve" : score >= 80 ? "Review closely" : "Likely reject";

  if (items.length === 0) {
    return (
      <>
        <SectionTitle
          title="Manual Review"
          desc="Approve or reject possible matches that fall between your review thresholds."
        />
        <EmptyState
          icon={ClipboardCheck}
          title="All caught up"
          description="No records need manual review. You can move on to Synchronize."
        />
      </>
    );
  }

  return (
    <>
      <SectionTitle
        title="Manual Review"
        desc="Approve or reject possible matches. Click any row to inspect side-by-side."
      />

      {/* toolbar */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 border border-border rounded-md px-2.5 py-1.5 w-64 bg-background">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search records…"
            className="w-full bg-transparent outline-none text-xs"
          />
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {filtered.length} of {items.length} records
        </p>
      </div>

      {/* table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col />
              <col />
              <col style={{ width: "140px" }} />
              <col style={{ width: "140px" }} />
              <col style={{ width: "180px" }} />
            </colgroup>
            <thead className="bg-secondary/60 sticky top-0 z-10 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Reference Record</th>
                <th className="text-left px-4 py-2.5 font-medium">Input Record</th>
                <th
                  className="text-right px-4 py-2.5 font-medium cursor-pointer select-none"
                  onClick={() => setSortDesc((v) => !v)}
                >
                  Similarity {sortDesc ? "↓" : "↑"}
                </th>
                <th className="text-left px-4 py-2.5 font-medium">Recommendation</th>
                <th className="text-right px-4 py-2.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paged.map((r) => {
                const tone =
                  r.score >= 90 ? "text-success" : r.score >= 80 ? "text-warning" : "text-destructive";
                return (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className="hover:bg-secondary/40 cursor-pointer"
                  >
                    <td className="px-4 py-3 min-w-0">
                      <p className="text-sm font-medium truncate">{r.refName}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.refMeta}</p>
                    </td>
                    <td className="px-4 py-3 min-w-0">
                      <p className="text-sm font-medium truncate">{r.inputName}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.inputMeta}</p>
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${tone}`}>
                      {r.score}%
                    </td>
                    <td className="px-4 py-3 text-xs">{recommendation(r.score)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => decide(r.id)}
                          className="px-2.5 py-1 rounded-md bg-brand text-brand-foreground text-xs font-medium"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => decide(r.id)}
                          className="px-2.5 py-1 rounded-md border border-border text-xs font-medium hover:bg-secondary"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2 py-1 rounded-md border border-border disabled:opacity-40 hover:bg-secondary"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2 py-1 rounded-md border border-border disabled:opacity-40 hover:bg-secondary"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base">Compare records</SheetTitle>
                <SheetDescription>{selected.id} · Similarity {selected.score}%</SheetDescription>
              </SheetHeader>
              <div className="mt-5 grid grid-cols-2 gap-4">
                {[
                  { title: "Reference", name: selected.refName, meta: selected.refMeta },
                  { title: "Input", name: selected.inputName, meta: selected.inputMeta },
                ].map((s) => (
                  <div key={s.title} className="border border-border rounded-lg p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {s.title}
                    </p>
                    <p className="text-sm font-medium mt-1 break-words">{s.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">{s.meta}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5">
                <p className="text-xs font-semibold mb-2">Column scores</p>
                <div className="space-y-2">
                  {[
                    { col: "Name", score: selected.score },
                    { col: "Identifier", score: Math.min(100, selected.score + 4) },
                    { col: "Address", score: Math.max(0, selected.score - 10) },
                  ].map((c) => (
                    <div key={c.col} className="grid grid-cols-[100px_1fr_50px] items-center gap-3">
                      <span className="text-xs">{c.col}</span>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-brand" style={{ width: `${c.score}%` }} />
                      </div>
                      <span className="text-xs font-semibold tabular-nums text-right">
                        {Math.round(c.score)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex gap-2">
                <button
                  onClick={() => decide(selected.id)}
                  className="flex-1 px-3 py-2 rounded-md bg-brand text-brand-foreground text-sm font-semibold"
                >
                  Approve
                </button>
                <button
                  onClick={() => decide(selected.id)}
                  className="flex-1 px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary"
                >
                  Reject
                </button>
                <button
                  onClick={() => setSelected(null)}
                  className="px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary"
                >
                  Skip
                </button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}



function StepSynchronize() {
  const [matchedAction, setMatchedAction] = useState("Drop / Skip matched input records");
  const [unmatchedAction, setUnmatchedAction] = useState("Append unmatched input records");
  const [possibleAction, setPossibleAction] = useState("Send to manual review");
  const [conflictAction, setConflictAction] = useState("Merge non-empty fields");

  return (
    <>
      <SectionTitle
        title="Synchronize"
        desc="Choose what happens to matched, unmatched, and uncertain records before exporting."
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          <SyncOptionGroup
            title="Matched Records"
            desc="Choose how to handle input records that already match the reference dataset."
            value={matchedAction}
            onChange={setMatchedAction}
            options={[
              "Drop / Skip matched input records",
              "Update existing reference records",
              "Keep both records",
            ]}
          />

          <SyncOptionGroup
            title="Unmatched Records"
            desc="Choose how new or unknown input records should be handled."
            value={unmatchedAction}
            onChange={setUnmatchedAction}
            options={[
              "Append unmatched input records",
              "Export unmatched separately",
              "Ignore unmatched records",
            ]}
          />

          <SyncOptionGroup
            title="Possible Match Records"
            desc="Choose how records below the auto-match threshold should be handled."
            value={possibleAction}
            onChange={setPossibleAction}
            options={["Send to manual review", "Export separately", "Ignore until reviewed"]}
          />

          <SyncOptionGroup
            title="Conflict Resolution"
            desc="Choose how field-level conflicts should be handled when both records have values."
            value={conflictAction}
            onChange={setConflictAction}
            options={[
              "Keep reference value",
              "Replace with input value",
              "Merge non-empty fields",
              "Send conflict to manual review",
            ]}
          />
        </div>

        <aside className="h-fit rounded-lg border border-border bg-secondary/20 p-5">
          <div className="mb-4">
            <p className="text-sm font-semibold">Summary preview</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Estimated impact based on the current match results.
            </p>
          </div>
          <div className="space-y-3">
            <SyncMetric label="Records to drop" value={synchronizationSummary.droppedMatched} />
            <SyncMetric label="Records to append" value={synchronizationSummary.appendedUnmatched} />
            <SyncMetric label="Conflict review" value={synchronizationSummary.conflictsToReview} />
            <div className="border-t border-border pt-3">
              <SyncMetric
                label="Final reference size"
                value={synchronizationSummary.finalReferenceSize}
                strong
              />
            </div>
          </div>

          <div className="mt-5 rounded-md border border-border bg-background px-3 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Selected merge plan
            </p>
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              <li>Matched: {matchedAction}</li>
              <li>Unmatched: {unmatchedAction}</li>
              <li>Possible: {possibleAction}</li>
              <li>Conflicts: {conflictAction}</li>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}

function SyncOptionGroup({
  title,
  desc,
  options,
  value,
  onChange,
}: {
  title: string;
  desc: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <section className="rounded-lg border border-border p-5">
      <div className="mb-4">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={[
                "min-h-16 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors",
                selected
                  ? "border-brand bg-brand/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
              ].join(" ")}
            >
              {option}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SyncMetric({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${strong ? "text-lg font-semibold" : "text-sm font-semibold"}`}>
        {value}
      </span>
    </div>
  );
}


function StepExport() {
  const options = [
    { label: "Excel (.xlsx)", desc: "Workbook with results, sync summary, and audit trail" },
    { label: "CSV (.csv)", desc: "Flat file with match scores and selected merge action" },
    { label: "Updated Reference", desc: "Preview output after applying the synchronization plan" },
  ];
  return (
    <>
      <SectionTitle title="Export Results" desc="Download results using the selected synchronization plan." />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {options.map((o) => (
          <button
            key={o.label}
            className="text-left border border-border rounded-lg p-4 hover:border-accent/40 hover:bg-secondary/40"
          >
            <p className="text-sm font-semibold">{o.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{o.desc}</p>
          </button>
        ))}
      </div>
    </>
  );
}
