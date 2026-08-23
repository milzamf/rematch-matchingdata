import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  User,
  Cpu,
  ShieldCheck,
  FileSpreadsheet,
  Building2,
  Mail,
  Shield,
  Sparkles,
  Lock,
  Save,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";

import { AppLayout, PageHeader, Card } from "@/components/app-layout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ConfirmationDialog, ErrorPanel, LoadingPanel } from "@/components/feedback-states";
import { getInitials, useAuth } from "@/lib/auth";
import { usePreferences } from "@/lib/preferences";

export type SettingsTab = "akun" | "engine" | "keamanan" | "ekspor";

export type SettingsSearch = {
  tab?: SettingsTab;
};

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): SettingsSearch => {
    const tab = search.tab;
    if (tab === "akun" || tab === "engine" || tab === "keamanan" || tab === "ekspor") {
      return { tab };
    }
    return { tab: "akun" };
  },
  head: () => ({
    meta: [
      { title: "Pengaturan - RE-MATCH" },
      { name: "description", content: "Kelola preferensi RE-MATCH" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const activeTab: SettingsTab = search.tab ?? "akun";

  const { language, resolvedTheme, setLanguage, setTheme, t, theme } = usePreferences();
  const { currentUser } = useAuth();

  const defaultMatchingDefaults = {
    preset: "Default",
    normalization: "Text Standardization",
    autoThreshold: "90",
    reviewThreshold: "70",
    searchOptimization: "Otomatis",
    candidateCount: "5",
    customStopwords: "pt, cv, tbk, persero, perseroda, perum, ud, yayasan, jalan, jl, no, nomor, gd, gedung, lt, lantai",
  };

  const defaultAiPreferences = {
    suggestions: true,
    columnMapping: true,
    configuration: true,
    reviewExplanation: true,
    tuning: false,
  };

  const defaultPrivacy = {
    nik: true,
    npwp: true,
    email: true,
    phone: true,
    maskedOnly: true,
    autoCleanup: "30 Hari",
  };

  const defaultExportPreferences = {
    exportFormat: "Excel (.xlsx)",
    csvDelimiter: "Titik Koma (;) - Standar Excel Indonesia",
    includeReferenceKey: true,
    includeAuditTrail: true,
    includeScore: true,
  };

  const [matchingDefaults, setMatchingDefaults] = useState(defaultMatchingDefaults);
  const [aiPreferences, setAiPreferences] = useState(defaultAiPreferences);
  const [privacy, setPrivacy] = useState(defaultPrivacy);
  const [exportPreferences, setExportPreferences] = useState(defaultExportPreferences);

  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const handleTabChange = (val: string) => {
    navigate({ search: { tab: val as SettingsTab } });
  };

  const resetLocalState = () => {
    setMatchingDefaults(defaultMatchingDefaults);
    setAiPreferences(defaultAiPreferences);
    setPrivacy(defaultPrivacy);
    setExportPreferences(defaultExportPreferences);
    setSettingsError(null);
    toast.info(t("feedback.toast.discarded") ?? "Perubahan dibatalkan.");
  };

  const saveLocalState = () => {
    const auto = Number(matchingDefaults.autoThreshold);
    const review = Number(matchingDefaults.reviewThreshold);
    if (!Number.isFinite(auto) || !Number.isFinite(review) || auto <= review) {
      setSettingsError(t("feedback.error.desc") ?? "Ambang batas auto-match harus lebih tinggi dari ambang batas review.");
      toast.error(t("feedback.error.title") ?? "Konfigurasi tidak valid");
      return;
    }
    setSettingsError(null);
    setSaving(true);
    window.setTimeout(() => {
      setSaving(false);
      toast.success(t("feedback.toast.saved") ?? "Pengaturan berhasil disimpan.");
    }, 600);
  };

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-[1100px] mx-auto space-y-6">
        <PageHeader
          title={t("settings.title") ?? "Pengaturan"}
          description={t("settings.description") ?? "Kelola preferensi akun, algoritma engine pencocokan, privasi data, dan format ekspor."}
        />

        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8 items-start"
        >
          {/* LEFT VERTICAL NAVIGATION */}
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-card p-1.5 shadow-xs">
              <TabsList className="flex flex-col w-full h-auto bg-transparent p-0 space-y-1">
                <TabsTrigger
                  value="akun"
                  className="w-full justify-start gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold data-[state=active]:bg-brand data-[state=active]:text-brand-foreground transition-all cursor-pointer"
                >
                  <User className="size-4 shrink-0" />
                  <span>{t("settings.tabAccount") ?? "Profil & Tampilan"}</span>
                </TabsTrigger>

                <TabsTrigger
                  value="engine"
                  className="w-full justify-start gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold data-[state=active]:bg-brand data-[state=active]:text-brand-foreground transition-all cursor-pointer"
                >
                  <Cpu className="size-4 shrink-0" />
                  <span>{t("settings.tabEngine") ?? "Konfigurasi Mesin"}</span>
                </TabsTrigger>

                <TabsTrigger
                  value="keamanan"
                  className="w-full justify-start gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold data-[state=active]:bg-brand data-[state=active]:text-brand-foreground transition-all cursor-pointer"
                >
                  <ShieldCheck className="size-4 shrink-0" />
                  <span>{t("settings.tabSecurity") ?? "Privasi & AI"}</span>
                </TabsTrigger>

                <TabsTrigger
                  value="ekspor"
                  className="w-full justify-start gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold data-[state=active]:bg-brand data-[state=active]:text-brand-foreground transition-all cursor-pointer"
                >
                  <FileSpreadsheet className="size-4 shrink-0" />
                  <span>{t("settings.tabExport") ?? "Format Ekspor"}</span>
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Quick Summary Pill */}
            <div className="rounded-xl border border-border/80 bg-secondary/30 p-3.5 space-y-1.5 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-brand" />
                <span>RE-MATCH Enterprise</span>
              </p>
              <p className="text-[11px] leading-relaxed">
                Pengaturan preferensi tersimpan secara lokal dan otomatis disinkronkan saat login.
              </p>
            </div>
          </div>

          {/* RIGHT ACTIVE CONTENT */}
          <div className="space-y-6 min-w-0">
            {/* TAB 1: AKUN & PROFIL & TAMPILAN */}
            <TabsContent value="akun" className="mt-0 space-y-6">
              {/* Profil Pengguna */}
              <Card className="p-6 space-y-5">
                <div>
                  <h3 className="text-base font-semibold text-foreground">Profil Pengguna</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Informasi identitas akun yang digunakan untuk jejak audit dan log reviu.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-xl border border-border/70 bg-secondary/20">
                  <Avatar className="size-14 shrink-0 border-2 border-brand/20">
                    <AvatarImage alt={currentUser?.name} src={currentUser?.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-brand/10 text-brand font-bold text-base">
                      {currentUser ? getInitials(currentUser.name) : "U"}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-bold text-foreground truncate">
                        {currentUser?.name || "Administrator"}
                      </h4>
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand capitalize">
                        <Shield className="size-3" />
                        {currentUser ? t(`auth.role.${currentUser.role}` as Parameters<typeof t>[0]) || currentUser.role : "Admin"}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate">
                      <Mail className="size-3.5 shrink-0" />
                      <span>{currentUser?.email || "admin@rematch.go.id"}</span>
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
                  <div className="rounded-lg border border-border bg-card p-3.5 space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                      <Building2 className="size-3.5 text-muted-foreground" />
                      {t("settings.organization") ?? "Organisasi"}
                    </span>
                    <p className="text-xs font-semibold text-foreground">
                      {t("brand.organization") ?? "Kementerian / Lembaga"}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border bg-card p-3.5 space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {t("settings.organizationUnit") ?? "Unit Kerja"}
                    </span>
                    <p className="text-xs font-semibold text-foreground">
                      {t("brand.organizationUnit") ?? "Pusat Data dan Informasi"}
                    </p>
                  </div>
                </div>
              </Card>

              {/* Preferensi Tampilan */}
              <Card className="p-6 space-y-6">
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {t("settings.preferencesTitle") ?? "Preferensi Tampilan"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.preferencesDescription") ?? "Sesuaikan tema visual dan bahasa tampilan aplikasi."}
                  </p>
                </div>

                <PreferenceSection title={t("settings.theme")} description={t("settings.themeHelp")}>
                  <div className="grid grid-cols-3 gap-2">
                    <PreferenceButton
                      active={theme === "light"}
                      onClick={() => setTheme("light")}
                      label={t("settings.light")}
                    />
                    <PreferenceButton
                      active={theme === "dark"}
                      onClick={() => setTheme("dark")}
                      label={t("settings.dark")}
                    />
                    <PreferenceButton
                      active={theme === "system"}
                      onClick={() => setTheme("system")}
                      label={`${t("settings.system")} (${resolvedTheme})`}
                    />
                  </div>
                </PreferenceSection>

                <div className="border-t border-border/70 pt-5">
                  <PreferenceSection
                    title={t("settings.language")}
                    description={t("settings.languageHelp")}
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <PreferenceButton
                        active={language === "en"}
                        onClick={() => setLanguage("en")}
                        label={t("settings.english")}
                      />
                      <PreferenceButton
                        active={language === "id"}
                        onClick={() => setLanguage("id")}
                        label={t("settings.indonesian")}
                      />
                    </div>
                  </PreferenceSection>
                </div>
              </Card>
            </TabsContent>

            {/* TAB 2: KONFIGURASI ENGINE */}
            <TabsContent value="engine" className="mt-0 space-y-6">
              <Card className="p-6 space-y-5">
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {t("settings.matchingDefaults") ?? "Ambang Batas & Algoritma Default"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.matchingDefaultsDesc") ?? "Job pencocokan baru akan secara otomatis menggunakan nilai default ini."}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label={t("settings.defaultPreset") ?? "Preset Default"}
                    value={matchingDefaults.preset}
                    onChange={(value) =>
                      setMatchingDefaults((current) => ({ ...current, preset: value }))
                    }
                    options={["Default", "Custom"]}
                  />
                  <Select
                    label={t("settings.defaultNormalization") ?? "Metode Normalisasi Default"}
                    value={matchingDefaults.normalization}
                    onChange={(value) =>
                      setMatchingDefaults((current) => ({ ...current, normalization: value }))
                    }
                    options={[
                      "Text Standardization",
                      "Basic",
                      "Entity Name",
                      "Address",
                      "Identifier Strict",
                    ]}
                  />
                  <Field
                    label={t("settings.defaultAutoThreshold") ?? "Ambang Batas Auto-Match (%)"}
                    value={matchingDefaults.autoThreshold}
                    onChange={(value) =>
                      setMatchingDefaults((current) => ({ ...current, autoThreshold: value }))
                    }
                    type="number"
                  />
                  <Field
                    label={t("settings.defaultReviewThreshold") ?? "Ambang Batas Perlu Reviu (%)"}
                    value={matchingDefaults.reviewThreshold}
                    onChange={(value) =>
                      setMatchingDefaults((current) => ({ ...current, reviewThreshold: value }))
                    }
                    type="number"
                  />
                  <Select
                    label={t("settings.searchOptimization") ?? "Strategi Optimasi Pencarian"}
                    value={matchingDefaults.searchOptimization}
                    onChange={(value) =>
                      setMatchingDefaults((current) => ({ ...current, searchOptimization: value }))
                    }
                    options={["Otomatis", "Identifier lebih dulu", "Wilayah + Nama", "Nama Entitas"]}
                  />
                  <Select
                    label={t("settings.candidateCount") ?? "Maksimal Kandidat per Record"}
                    value={matchingDefaults.candidateCount}
                    onChange={(value) =>
                      setMatchingDefaults((current) => ({ ...current, candidateCount: value }))
                    }
                    options={["1", "3", "5", "10"]}
                  />
                </div>
              </Card>

              {/* NEW FEATURE: CUSTOM STOPWORDS */}
              <Card className="p-6 space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <SlidersHorizontal className="size-4 text-brand" />
                    <span>{t("settings.customStopwords") ?? "Stopwords Khusus (Kata yang Diabaikan)"}</span>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.customStopwordsDesc") ??
                      "Daftar kata yang akan otomatis diabaikan atau dibersihkan saat engine melakukan perbandingan teks (pisahkan dengan koma)."}
                  </p>
                </div>

                <div className="space-y-2">
                  <textarea
                    rows={4}
                    value={matchingDefaults.customStopwords}
                    onChange={(e) =>
                      setMatchingDefaults((current) => ({
                        ...current,
                        customStopwords: e.target.value,
                      }))
                    }
                    placeholder="pt, cv, tbk, persero, jalan, no, nomor, gedung, lantai..."
                    className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand leading-relaxed"
                  />
                  <p className="text-[11px] text-muted-foreground italic">
                    Contoh: singkatan badan usaha, kata penghubung alamat, atau prefiks dokumen yang tidak relevan dengan kesamaan entitas.
                  </p>
                </div>
              </Card>
            </TabsContent>

            {/* TAB 3: PRIVASI & AI */}
            <TabsContent value="keamanan" className="mt-0 space-y-6">
              <SettingsSection
                title={t("settings.aiPreferences") ?? "Fitur Kecerdasan Buatan (AI)"}
                description={
                  t("settings.aiPreferencesDesc") ??
                  "Aktifkan asisten AI untuk memandu pemetaan kolom dan memberikan analisis reviu."
                }
              >
                <Toggle
                  label={t("settings.enableAiSuggestions") ?? "Aktifkan Saran AI"}
                  checked={aiPreferences.suggestions}
                  onChange={(checked) =>
                    setAiPreferences((current) => ({ ...current, suggestions: checked }))
                  }
                />
                <Toggle
                  label={t("settings.columnMappingSuggestions") ?? "Saran Pemetaan Kolom Otomatis"}
                  checked={aiPreferences.columnMapping}
                  onChange={(checked) =>
                    setAiPreferences((current) => ({ ...current, columnMapping: checked }))
                  }
                />
                <Toggle
                  label={t("settings.matchingConfigurationRecommendations") ?? "Rekomendasi Bobot & Aturan"}
                  checked={aiPreferences.configuration}
                  onChange={(checked) =>
                    setAiPreferences((current) => ({ ...current, configuration: checked }))
                  }
                />
                <Toggle
                  label={t("settings.reviewExplanation") ?? "Penjelasan Hasil Review (AI Diagnosis)"}
                  checked={aiPreferences.reviewExplanation}
                  onChange={(checked) =>
                    setAiPreferences((current) => ({ ...current, reviewExplanation: checked }))
                  }
                />
                <Toggle
                  label={t("settings.tuningRecommendations") ?? "Rekomendasi Penyesuaian Algoritma (Tuning)"}
                  checked={aiPreferences.tuning}
                  onChange={(checked) =>
                    setAiPreferences((current) => ({ ...current, tuning: checked }))
                  }
                />
              </SettingsSection>

              <SettingsSection
                title={t("settings.dataPrivacy") ?? "Privasi & Masking Data"}
                description={
                  t("settings.dataPrivacyDesc") ??
                  "Pilih kolom data sensitif yang harus disamarkan (masking) sebelum pemrosesan atau log."
                }
              >
                <Toggle
                  label={t("settings.maskNik") ?? "Samarkan NIK (Nomor Induk Kependudukan)"}
                  checked={privacy.nik}
                  onChange={(checked) => setPrivacy((current) => ({ ...current, nik: checked }))}
                />
                <Toggle
                  label={t("settings.maskNpwp") ?? "Samarkan NPWP (Nomor Pokok Wajib Pajak)"}
                  checked={privacy.npwp}
                  onChange={(checked) => setPrivacy((current) => ({ ...current, npwp: checked }))}
                />
                <Toggle
                  label={t("settings.maskEmail") ?? "Samarkan Alamat Email"}
                  checked={privacy.email}
                  onChange={(checked) => setPrivacy((current) => ({ ...current, email: checked }))}
                />
                <Toggle
                  label={t("settings.maskPhone") ?? "Samarkan Nomor Telepon / HP"}
                  checked={privacy.phone}
                  onChange={(checked) => setPrivacy((current) => ({ ...current, phone: checked }))}
                />
                <Toggle
                  label={t("settings.aiMaskedOnly") ?? "Kirim Data Hanya dalam Bentuk Masked ke AI"}
                  checked={privacy.maskedOnly}
                  onChange={(checked) =>
                    setPrivacy((current) => ({ ...current, maskedOnly: checked }))
                  }
                />
              </SettingsSection>

              {/* NEW FEATURE: AUTOMATED DATA RETENTION */}
              <Card className="p-6 space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <Lock className="size-4 text-brand" />
                    <span>{t("settings.autoCleanup") ?? "Pembersihan Data Otomatis (Data Retention)"}</span>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.autoCleanupDesc") ??
                      "Otomatis membersihkan dataset sementara dan workspace yang tidak aktif setelah jangka waktu tertentu untuk tata kelola data."}
                  </p>
                </div>

                <div className="max-w-md">
                  <Select
                    label="Periode Retensi Dataset Sementara"
                    value={privacy.autoCleanup}
                    onChange={(val) => setPrivacy((current) => ({ ...current, autoCleanup: val }))}
                    options={[
                      "Tidak Pernah (Manual)",
                      "7 Hari",
                      "14 Hari",
                      "30 Hari",
                      "90 Hari",
                    ]}
                  />
                </div>
              </Card>
            </TabsContent>

            {/* TAB 4: FORMAT EKSPOR */}
            <TabsContent value="ekspor" className="mt-0 space-y-6">
              <Card className="p-6 space-y-5">
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {t("settings.tabExport") ?? "Pengaturan Format Ekspor"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Konfigurasi default struktur dan pembatas file saat mengunduh hasil pencocokan.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label={t("settings.defaultExportFormat") ?? "Format File Default"}
                    value={exportPreferences.exportFormat}
                    onChange={(val) =>
                      setExportPreferences((current) => ({ ...current, exportFormat: val }))
                    }
                    options={["Excel (.xlsx)", "CSV (.csv)", "JSON (.json)", "Parquet (.parquet)"]}
                  />

                  {/* NEW FEATURE: CSV DELIMITER */}
                  <Select
                    label={t("settings.csvDelimiter") ?? "Pemisah Kolom CSV (Delimiter)"}
                    value={exportPreferences.csvDelimiter}
                    onChange={(val) =>
                      setExportPreferences((current) => ({ ...current, csvDelimiter: val }))
                    }
                    options={[
                      "Koma (,) - Standar Internasional",
                      "Titik Koma (;) - Standar Excel Indonesia",
                      "Tab (\\t) - TSV",
                    ]}
                  />
                </div>

                <p className="text-[11px] text-muted-foreground">
                  {t("settings.csvDelimiterDesc") ??
                    "Pemisah titik koma (;) direkomendasikan agar file CSV langsung rapi saat dibuka di Microsoft Excel dengan konfigurasi regional Indonesia."}
                </p>
              </Card>

              <SettingsSection
                title="Metadata & Kolom Audit Tambahan"
                description="Tentukan kolom sistem yang otomatis disertakan pada file ekspor hasil pencocokan."
              >
                <Toggle
                  label="Sertakan Kunci / ID Record Referensi"
                  checked={exportPreferences.includeReferenceKey}
                  onChange={(checked) =>
                    setExportPreferences((current) => ({
                      ...current,
                      includeReferenceKey: checked,
                    }))
                  }
                />
                <Toggle
                  label="Sertakan Jejak Audit & Riwayat Reviewer"
                  checked={exportPreferences.includeAuditTrail}
                  onChange={(checked) =>
                    setExportPreferences((current) => ({
                      ...current,
                      includeAuditTrail: checked,
                    }))
                  }
                />
                <Toggle
                  label="Sertakan Skor Kemiripan Numerik (%)"
                  checked={exportPreferences.includeScore}
                  onChange={(checked) =>
                    setExportPreferences((current) => ({ ...current, includeScore: checked }))
                  }
                />
              </SettingsSection>
            </TabsContent>

            {/* Error and Loading panels */}
            {settingsError && (
              <ErrorPanel
                title={t("feedback.error.title") ?? "Gagal Menyimpan"}
                description={settingsError}
                action={
                  <button
                    onClick={() => setSettingsError(null)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary cursor-pointer"
                  >
                    {t("common.tryAgain") ?? "Coba Lagi"}
                  </button>
                }
              />
            )}

            {saving && (
              <LoadingPanel
                title={t("feedback.loading.title") ?? "Menyimpan"}
                description={t("feedback.loading.desc") ?? "Menerapkan konfigurasi ke sistem..."}
              />
            )}

            {/* ACTION BUTTONS */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDiscardOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-secondary transition-colors cursor-pointer"
              >
                <RotateCcw className="size-3.5 text-muted-foreground" />
                <span>{t("common.discard") ?? "Batal"}</span>
              </button>
              <button
                type="button"
                onClick={saveLocalState}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-brand-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity cursor-pointer shadow-xs"
              >
                <Save className="size-3.5" />
                <span>{t("common.saveChanges") ?? "Simpan Perubahan"}</span>
              </button>
            </div>

            <ConfirmationDialog
              open={discardOpen}
              setOpen={setDiscardOpen}
              title={t("feedback.confirm.discardTitle") ?? "Batalkan Perubahan?"}
              description={
                t("feedback.confirm.discardDesc") ??
                "Semua perubahan yang belum disimpan akan dikembalikan ke nilai awal."
              }
              cancelLabel={t("common.cancel") ?? "Batal"}
              actionLabel={t("common.discard") ?? "Kembalikan"}
              onConfirm={resetLocalState}
            />
          </div>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function SettingsSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <Card className="p-6 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </Card>
  );
}

function Field({
  label,
  onChange,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "number";
  value: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
      />
    </label>
  );
}

function Select({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand cursor-pointer"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function PreferenceSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] sm:items-center">
      <div>
        <h4 className="text-xs font-semibold text-foreground">{title}</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function PreferenceButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        "min-h-9 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer",
        active
          ? "border-brand bg-brand text-brand-foreground shadow-xs"
          : "border-border bg-background text-foreground hover:bg-secondary",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-2.5 cursor-pointer select-none">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className="h-5 w-9 rounded-full bg-secondary peer-checked:bg-brand transition-colors" />
        <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}
