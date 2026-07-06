import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AppLayout, PageHeader, Card } from "@/components/app-layout";
import { useAuth, getInitials } from "@/lib/auth";
import { usePreferences } from "@/lib/preferences";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings - BatchMatch" },
      { name: "description", content: "Manage your BatchMatch preferences, profile, and defaults." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const { language, resolvedTheme, setLanguage, setTheme, t, theme } = usePreferences();

  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-[900px] mx-auto">
        <PageHeader title={t("settings.title")} description={t("settings.description")} />

        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="text-base font-semibold mb-1">{t("settings.profile")}</h3>
            <p className="text-sm text-muted-foreground mb-5">
              {t("settings.profileDesc")}
            </p>
            <div className="flex items-center gap-4 mb-5">
              <div className="size-14 rounded-full bg-brand text-brand-foreground grid place-items-center text-lg font-semibold">
                {user ? getInitials(user.fullName) : "??"}
              </div>
              <button className="text-sm font-medium border border-border rounded-md px-3 py-1.5 hover:bg-secondary">
                {t("settings.changePhoto")}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={t("settings.fullName")} defaultValue={user?.fullName ?? ""} />
              <Field label={t("settings.username")} defaultValue={user?.username ?? ""} />
              <Field label={t("settings.email")} defaultValue={user?.email ?? ""} />
              <Field label={t("settings.timezone")} defaultValue="Asia/Jakarta (GMT+7)" />
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-base font-semibold mb-1">{t("settings.matchingDefaults")}</h3>
            <p className="text-sm text-muted-foreground mb-5">
              {t("settings.matchingDefaultsDesc")}
            </p>
            <div className="space-y-4">
              <Select
                label={t("settings.defaultPreset")}
                options={["Balanced", "Strict", "Exploratory", "Custom"]}
              />
              <Select
                label={t("settings.defaultNormalization")}
                options={["Text Standardization", "Basic", "Entity Name", "Address", "Identifier Strict"]}
              />
              <Field label={t("settings.defaultAutoThreshold")} defaultValue="90" />
              <Field label={t("settings.defaultReviewThreshold")} defaultValue="70" />
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

              <div className="border-t border-border pt-4 space-y-3">
                <Toggle label={t("settings.notifications")} defaultChecked />
                <Toggle label={t("settings.profiling")} defaultChecked />
                <Toggle label={t("settings.shortcuts")} defaultChecked />
                <Toggle label={t("settings.beta")} />
              </div>
            </div>
          </Card>

          <div className="flex justify-end gap-2">
            <button className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary">
              {t("common.discard")}
            </button>
            <button className="px-4 py-2 rounded-md bg-brand text-brand-foreground text-sm font-semibold hover:opacity-90">
              {t("common.saveChanges")}
            </button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function Field({ label, defaultValue }: { label: string; defaultValue: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        defaultValue={defaultValue}
        className="mt-1.5 w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  );
}

function Select({ label, options }: { label: string; options: string[] }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select className="mt-1.5 w-full bg-background border border-border rounded-md px-3 py-2 text-sm">
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

function Toggle({ label, defaultChecked }: { label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-4 py-2 cursor-pointer">
      <span className="text-sm">{label}</span>
      <span className="relative inline-flex shrink-0">
        <input type="checkbox" defaultChecked={defaultChecked} className="peer sr-only" />
        <span className="h-5 w-9 rounded-full bg-secondary peer-checked:bg-brand transition-colors" />
        <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}
