import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { AppLayout, PageHeader, Card } from "@/components/app-layout";
import { ConfirmationDialog, ErrorPanel, LoadingPanel } from "@/components/feedback-states";
import { usePreferences } from "@/lib/preferences";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Pengaturan - RE-MATCH" },
      { name: "description", content: "Kelola preferensi RE-MATCH" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { language, resolvedTheme, setLanguage, setTheme, t, theme } = usePreferences();
  const defaultMatchingDefaults = {
    preset: "Balanced",
    normalization: "Text Standardization",
    autoThreshold: "90",
    reviewThreshold: "70",
    searchOptimization: "Auto Recommend",
    candidateCount: "5",
    exportFormat: "Excel (.xlsx)",
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
  };
  const [matchingDefaults, setMatchingDefaults] = useState(defaultMatchingDefaults);
  const [aiPreferences, setAiPreferences] = useState(defaultAiPreferences);
  const [privacy, setPrivacy] = useState(defaultPrivacy);
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const resetLocalState = () => {
    setMatchingDefaults(defaultMatchingDefaults);
    setAiPreferences(defaultAiPreferences);
    setPrivacy(defaultPrivacy);
    setSettingsError(null);
    toast.info(t("feedback.toast.discarded"));
  };

  const saveLocalState = () => {
    const auto = Number(matchingDefaults.autoThreshold);
    const review = Number(matchingDefaults.reviewThreshold);
    if (!Number.isFinite(auto) || !Number.isFinite(review) || auto <= review) {
      setSettingsError(t("feedback.error.desc"));
      toast.error(t("feedback.error.title"));
      return;
    }
    setSettingsError(null);
    setSaving(true);
    window.setTimeout(() => {
      setSaving(false);
      toast.success(t("feedback.toast.saved"));
    }, 700);
  };

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-[900px] mx-auto">
        <PageHeader title={t("settings.title")} description={t("settings.description")} />

        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="text-base font-semibold mb-1">{t("settings.systemIdentity")}</h3>
            <p className="text-sm text-muted-foreground mb-5">
              {t("settings.systemIdentityDesc")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ReadOnlyItem label={t("settings.applicationName")} value="RE-MATCH" />
              <ReadOnlyItem label={t("settings.organization")} value={t("brand.organization")} />
              <ReadOnlyItem label={t("settings.organizationUnit")} value={t("brand.organizationUnit")} />
              <ReadOnlyItem label={t("settings.userIdentity")} value={t("settings.authDeferred")} />
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-base font-semibold mb-1">{t("settings.matchingDefaults")}</h3>
            <p className="text-sm text-muted-foreground mb-5">
              {t("settings.matchingDefaultsDesc")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label={t("settings.defaultPreset")}
                value={matchingDefaults.preset}
                onChange={(value) =>
                  setMatchingDefaults((current) => ({ ...current, preset: value }))
                }
                options={["Balanced", "Strict", "Exploratory", "Custom"]}
              />
              <Select
                label={t("settings.defaultNormalization")}
                value={matchingDefaults.normalization}
                onChange={(value) =>
                  setMatchingDefaults((current) => ({ ...current, normalization: value }))
                }
                options={["Text Standardization", "Basic", "Entity Name", "Address", "Identifier Strict"]}
              />
              <Field
                label={t("settings.defaultAutoThreshold")}
                value={matchingDefaults.autoThreshold}
                onChange={(value) =>
                  setMatchingDefaults((current) => ({ ...current, autoThreshold: value }))
                }
                type="number"
              />
              <Field
                label={t("settings.defaultReviewThreshold")}
                value={matchingDefaults.reviewThreshold}
                onChange={(value) =>
                  setMatchingDefaults((current) => ({ ...current, reviewThreshold: value }))
                }
                type="number"
              />
              <Select
                label={t("settings.searchOptimization")}
                value={matchingDefaults.searchOptimization}
                onChange={(value) =>
                  setMatchingDefaults((current) => ({ ...current, searchOptimization: value }))
                }
                options={["Otomatis", "Identifier lebih dulu", "Wilayah + Nama", "Nama Entitas"]}
              />
              <Select
                label={t("settings.candidateCount")}
                value={matchingDefaults.candidateCount}
                onChange={(value) =>
                  setMatchingDefaults((current) => ({ ...current, candidateCount: value }))
                }
                options={["1", "3", "5", "10"]}
              />
              <Select
                label={t("settings.defaultExportFormat")}
                value={matchingDefaults.exportFormat}
                onChange={(value) =>
                  setMatchingDefaults((current) => ({ ...current, exportFormat: value }))
                }
                options={["Excel (.xlsx)", "CSV (.csv)", "JSON (.json)", "Parquet (.parquet)"]}
              />
            </div>
          </Card>

          <Card className="p-6">
            <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-base font-semibold">{t("settings.preferencesTitle")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("settings.preferencesDescription")}
                </p>
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                {t("settings.saved")}
              </span>
            </div>

            <div className="space-y-6">
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

          <SettingsSection
            title={t("settings.aiPreferences")}
            description={t("settings.aiPreferencesDesc")}
          >
            <Toggle
              label={t("settings.enableAiSuggestions")}
              checked={aiPreferences.suggestions}
              onChange={(checked) =>
                setAiPreferences((current) => ({ ...current, suggestions: checked }))
              }
            />
            <Toggle
              label={t("settings.columnMappingSuggestions")}
              checked={aiPreferences.columnMapping}
              onChange={(checked) =>
                setAiPreferences((current) => ({ ...current, columnMapping: checked }))
              }
            />
            <Toggle
              label={t("settings.matchingConfigurationRecommendations")}
              checked={aiPreferences.configuration}
              onChange={(checked) =>
                setAiPreferences((current) => ({ ...current, configuration: checked }))
              }
            />
            <Toggle
              label={t("settings.reviewExplanation")}
              checked={aiPreferences.reviewExplanation}
              onChange={(checked) =>
                setAiPreferences((current) => ({ ...current, reviewExplanation: checked }))
              }
            />
            <Toggle
              label={t("settings.tuningRecommendations")}
              checked={aiPreferences.tuning}
              onChange={(checked) =>
                setAiPreferences((current) => ({ ...current, tuning: checked }))
              }
            />
          </SettingsSection>

          <SettingsSection title={t("settings.dataPrivacy")} description={t("settings.dataPrivacyDesc")}>
            <Toggle
              label={t("settings.maskNik")}
              checked={privacy.nik}
              onChange={(checked) => setPrivacy((current) => ({ ...current, nik: checked }))}
            />
            <Toggle
              label={t("settings.maskNpwp")}
              checked={privacy.npwp}
              onChange={(checked) => setPrivacy((current) => ({ ...current, npwp: checked }))}
            />
            <Toggle
              label={t("settings.maskEmail")}
              checked={privacy.email}
              onChange={(checked) => setPrivacy((current) => ({ ...current, email: checked }))}
            />
            <Toggle
              label={t("settings.maskPhone")}
              checked={privacy.phone}
              onChange={(checked) => setPrivacy((current) => ({ ...current, phone: checked }))}
            />
            <Toggle
              label={t("settings.aiMaskedOnly")}
              checked={privacy.maskedOnly}
              onChange={(checked) =>
                setPrivacy((current) => ({ ...current, maskedOnly: checked }))
              }
            />
          </SettingsSection>

          <Card className="p-6">
            <h3 className="text-base font-semibold mb-1">{t("settings.about")}</h3>
            <p className="text-sm text-muted-foreground mb-5">{t("settings.aboutDesc")}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <ReadOnlyItem label={t("settings.batchmatchVersion")} value="RE-MATCH v0.1.0 MVP" />
              <ReadOnlyItem label={t("settings.buildType")} value={t("settings.frontendMockBuild")} />
              <ReadOnlyItem
                label={t("settings.documentation")}
                value={t("settings.documentationPlaceholder")}
                onClick={() => toast.info(t("feedback.toast.documentation"))}
              />
            </div>
          </Card>

          {settingsError && (
            <ErrorPanel
              title={t("feedback.error.title")}
              description={settingsError}
              action={
                <button
                  onClick={() => setSettingsError(null)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                >
                  {t("common.tryAgain")}
                </button>
              }
            />
          )}

          {saving && (
            <LoadingPanel title={t("feedback.loading.title")} description={t("feedback.loading.desc")} />
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDiscardOpen(true)}
              className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary"
            >
              {t("common.discard")}
            </button>
            <button
              onClick={saveLocalState}
              disabled={saving}
              className="px-4 py-2 rounded-md bg-brand text-brand-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
            >
              {t("common.saveChanges")}
            </button>
          </div>
          <ConfirmationDialog
            open={discardOpen}
            setOpen={setDiscardOpen}
            title={t("feedback.confirm.discardTitle")}
            description={t("feedback.confirm.discardDesc")}
            cancelLabel={t("common.cancel")}
            actionLabel={t("common.discard")}
            onConfirm={resetLocalState}
          />
        </div>
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
    <Card className="p-6">
      <h3 className="text-base font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-5">{description}</p>
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
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
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
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
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
    <section className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] md:items-start">
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
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
        "min-h-10 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-brand bg-brand text-brand-foreground"
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
    <label className="flex items-center justify-between gap-4 py-2 cursor-pointer">
      <span className="text-sm">{label}</span>
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

function ReadOnlyItem({
  label,
  onClick,
  value,
}: {
  label: string;
  onClick?: () => void;
  value: string;
}) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className="rounded-lg border border-border bg-secondary/20 p-4 text-left"
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </Component>
  );
}
