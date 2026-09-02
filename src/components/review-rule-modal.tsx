import { useState, useEffect } from "react";
import { X, Plus, Trash2, Sparkles, Loader2, SlidersHorizontal } from "lucide-react";
import {
  createReviewRule,
  type ReviewRuleCondition,
  type ReviewRuleDefinition,
} from "@/lib/api";

interface ReviewRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobId: string;
  initialData?: {
    name?: string;
    description?: string;
    conditions?: ReviewRuleCondition[];
    action_recommendation?: "accept" | "reject" | "manual";
  } | null;
  onSaved: (rule: ReviewRuleDefinition) => void;
}

export function ReviewRuleModal({
  isOpen,
  onClose,
  jobId,
  initialData,
  onSaved,
}: ReviewRuleModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [actionRecommendation, setActionRecommendation] = useState<"accept" | "reject" | "manual">("manual");
  const [conditions, setConditions] = useState<ReviewRuleCondition[]>([
    { source: "input", field: "nama_penyedia", operator: "contains", value: "" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(initialData?.name ?? "");
      setDescription(initialData?.description ?? "");
      setActionRecommendation(initialData?.action_recommendation ?? "manual");
      if (initialData?.conditions && initialData.conditions.length > 0) {
        setConditions(initialData.conditions);
      } else {
        setConditions([
          { source: "input", field: "nama_penyedia", operator: "contains", value: "" },
        ]);
      }
      setErrorMessage(null);
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleAddCondition = () => {
    setConditions((prev) => [
      ...prev,
      { source: "input", field: "alamat", operator: "contains", value: "" },
    ]);
  };

  const handleRemoveCondition = (index: number) => {
    if (conditions.length <= 1) return;
    setConditions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleConditionChange = (
    index: number,
    field: keyof ReviewRuleCondition,
    val: string,
  ) => {
    setConditions((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: val } : c)),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage("Nama aturan wajib diisi.");
      return;
    }

    // Validate conditions
    for (const c of conditions) {
      if (!c.field.trim()) {
        setErrorMessage("Nama kolom pada setiap kondisi wajib diisi.");
        return;
      }
      if (
        !["is_empty", "is_not_empty"].includes(c.operator) &&
        (!c.value || !c.value.trim())
      ) {
        setErrorMessage("Nilai pembanding wajib diisi untuk operator ini.");
        return;
      }
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await createReviewRule(jobId, {
        name: name.trim(),
        description: description.trim() || undefined,
        action_recommendation: actionRecommendation,
        conditions,
      });
      onSaved(res.data);
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Gagal menyimpan aturan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-secondary/20">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <SlidersHorizontal className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Tambah Aturan Review
              </h3>
              <p className="text-xs text-muted-foreground">
                Kustomisasi logika pengelompokan otomatis untuk data Need Review
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMessage && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
              {errorMessage}
            </div>
          )}

          {/* Nama Aturan */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">
              Nama Aturan <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Beda Sektor KBLI, Nama Mengandung Cabang"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              required
            />
          </div>

          {/* Deskripsi */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Deskripsi / Alasan Evaluasi (Opsional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Jelaskan karakteristik data yang dicakup oleh aturan ini"
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand resize-none"
            />
          </div>

          {/* Conditions */}
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-brand" />
                Kondisi Pemicu Evaluasi
              </label>
              <button
                type="button"
                onClick={handleAddCondition}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline cursor-pointer"
              >
                <Plus className="size-3" /> Tambah Kondisi
              </button>
            </div>

            <div className="space-y-2.5">
              {conditions.map((cond, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 sm:grid-cols-[90px_1fr_120px_1fr_auto] items-center gap-2 rounded-lg border border-border bg-secondary/30 p-2.5"
                >
                  {/* Source */}
                  <select
                    value={cond.source ?? "input"}
                    onChange={(e) =>
                      handleConditionChange(idx, "source", e.target.value as any)
                    }
                    className="rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none"
                  >
                    <option value="input">Input</option>
                    <option value="reference">Acuan</option>
                    <option value="comparison">Skor</option>
                  </select>

                  {/* Field */}
                  <input
                    type="text"
                    value={cond.field}
                    onChange={(e) =>
                      handleConditionChange(idx, "field", e.target.value)
                    }
                    placeholder="Nama Kolom (e.g. nama_penyedia)"
                    className="rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none"
                  />

                  {/* Operator */}
                  <select
                    value={cond.operator}
                    onChange={(e) =>
                      handleConditionChange(idx, "operator", e.target.value as any)
                    }
                    className="rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none"
                  >
                    <option value="contains">Mengandung</option>
                    <option value="does_not_contain">Tidak Mengandung</option>
                    <option value="equals">Sama Dengan (=)</option>
                    <option value="not_equals">Beda (!=)</option>
                    <option value="greater_than">Lebih Dari (&gt;)</option>
                    <option value="less_than">Kurang Dari (&lt;)</option>
                    <option value="is_empty">Kosong</option>
                    <option value="is_not_empty">Terisi</option>
                  </select>

                  {/* Value */}
                  {!["is_empty", "is_not_empty"].includes(cond.operator) ? (
                    <input
                      type="text"
                      value={cond.value ?? ""}
                      onChange={(e) =>
                        handleConditionChange(idx, "value", e.target.value)
                      }
                      placeholder="Nilai target..."
                      className="rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none"
                    />
                  ) : (
                    <div className="text-[11px] text-muted-foreground italic px-2">
                      (Tidak perlu nilai)
                    </div>
                  )}

                  {/* Remove Button */}
                  <button
                    type="button"
                    onClick={() => handleRemoveCondition(idx)}
                    disabled={conditions.length <= 1}
                    className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    title="Hapus kondisi"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Action Recommendation */}
          <div className="space-y-1.5 pt-2 border-t border-border">
            <label className="text-xs font-semibold text-foreground">
              Rekomendasi Keputusan untuk Kelompok Ini
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "manual", label: "Tinjau Manual", color: "border-border bg-secondary/40 text-foreground" },
                { id: "accept", label: "Rekomendasi Setuju", color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
                { id: "reject", label: "Rekomendasi Tolak", color: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setActionRecommendation(opt.id as any)}
                  className={[
                    "rounded-lg border px-3 py-2 text-xs font-semibold transition-all cursor-pointer text-center",
                    actionRecommendation === opt.id
                      ? `${opt.color} ring-2 ring-brand ring-offset-1`
                      : "border-border bg-card text-muted-foreground hover:bg-secondary/50",
                  ].join(" ")}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-brand-foreground shadow-sm hover:bg-brand/90 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                "Simpan Aturan Review"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
