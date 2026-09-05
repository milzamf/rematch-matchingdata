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
  Lock,
  Save,
  RotateCcw,
  SlidersHorizontal,
  Pencil,
  KeyRound,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { AppLayout, PageHeader, Card } from "@/components/app-layout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
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

  // Engine defaults (purged column-specific normalisasi, optimasi, and preset)
  const defaultMatchingDefaults = {
    autoThreshold: "90",
    reviewThreshold: "70",
    customStopwords:
      "pt, cv, tbk, persero, perseroda, perum, ud, yayasan, jalan, jl, no, nomor, gd, gedung, lt, lantai",
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
    csvDelimiter: "Titik Koma (;)",
    includeReferenceKey: true,
    includeAuditTrail: true,
    includeScore: true,
  };

  const [matchingDefaults, setMatchingDefaults] = useState(defaultMatchingDefaults);
  const [aiPreferences, setAiPreferences] = useState(defaultAiPreferences);
  const [privacy, setPrivacy] = useState(defaultPrivacy);
  const [exportPreferences, setExportPreferences] = useState(defaultExportPreferences);

  // Edit profile modal state
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [editName, setEditName] = useState(currentUser?.name || "");

  // Password change state
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const handleTabChange = (val: string) => {
    navigate({ search: { tab: val as SettingsTab } });
  };

  const handleUpdatePassword = () => {
    if (!oldPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      toast.error(t("settings.passwordRequired"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("settings.passwordMismatch"));
      return;
    }
    if (newPassword.length < 8) {
      toast.error(t("settings.passwordTooShort"));
      return;
    }

    setIsUpdatingPassword(true);
    window.setTimeout(() => {
      setIsUpdatingPassword(false);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success(t("settings.passwordUpdated"));
    }, 600);
  };

  const resetLocalState = () => {
    setMatchingDefaults(defaultMatchingDefaults);
    setAiPreferences(defaultAiPreferences);
    setPrivacy(defaultPrivacy);
    setExportPreferences(defaultExportPreferences);
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
    }, 600);
  };

  return (
    <AppLayout>
      <div className="px-6 lg:px-10 py-8 max-w-[1100px] mx-auto space-y-6">
        <PageHeader
          title={t("settings.title")}
          description={t("settings.description")}
        />

        <Tabs
          orientation="vertical"
          value={activeTab}
          onValueChange={handleTabChange}
          className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8 items-start"
        >
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-card p-1.5 shadow-xs">
              <TabsList className="flex flex-col w-full h-auto bg-transparent p-0 space-y-1">
                <TabsTrigger
                  value="akun"
                  className="w-full justify-start gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold data-[state=active]:bg-brand data-[state=active]:text-brand-foreground transition-all cursor-pointer"
                >
                  <User className="size-4 shrink-0" />
                  <span>{t("settings.tabAccount")}</span>
                </TabsTrigger>

                <TabsTrigger
                  value="engine"
                  className="w-full justify-start gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold data-[state=active]:bg-brand data-[state=active]:text-brand-foreground transition-all cursor-pointer"
                >
                  <Cpu className="size-4 shrink-0" />
                  <span>{t("settings.tabEngine")}</span>
                </TabsTrigger>

                <TabsTrigger
                  value="keamanan"
                  className="w-full justify-start gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold data-[state=active]:bg-brand data-[state=active]:text-brand-foreground transition-all cursor-pointer"
                >
                  <ShieldCheck className="size-4 shrink-0" />
                  <span>{t("settings.tabSecurity")}</span>
                </TabsTrigger>

                <TabsTrigger
                  value="ekspor"
                  className="w-full justify-start gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold data-[state=active]:bg-brand data-[state=active]:text-brand-foreground transition-all cursor-pointer"
                >
                  <FileSpreadsheet className="size-4 shrink-0" />
                  <span>{t("settings.tabExport")}</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="rounded-xl border border-border/80 bg-secondary/30 p-3.5 space-y-1.5 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-brand" />
                <span>{t("settings.enterpriseTitle")}</span>
              </p>
              <p className="text-[11px] leading-relaxed">
                {t("settings.enterpriseDesc")}
              </p>
            </div>
          </div>

          <div className="space-y-6 min-w-0">
            <TabsContent value="akun" forceMount className="mt-0 space-y-6 data-[state=inactive]:hidden">
              <Card className="p-6 space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">{t("settings.userIdentity")}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("settings.userIdentityDesc")}
                    </p>
                  </div>

                  <Dialog open={isEditProfileOpen} onOpenChange={setIsEditProfileOpen}>
                    <DialogTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary transition-colors cursor-pointer shrink-0 shadow-xs"
                      >
                        <Pencil className="size-3.5 text-muted-foreground" />
                        <span>{t("settings.editProfile")}</span>
                      </button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>{t("settings.editProfileTitle")}</DialogTitle>
                        <DialogDescription>
                          {t("settings.editProfileDesc")}
                        </DialogDescription>
                      </DialogHeader>

                      <div className="space-y-4 py-2">
                        <label className="block space-y-1.5">
                          <span className="text-xs font-medium text-foreground">{t("settings.fullName")}</span>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder={t("settings.fullName")}
                            className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
                          />
                        </label>

                        <label className="block space-y-1.5">
                          <span className="text-xs font-medium text-foreground">{t("settings.emailSso")}</span>
                          <input
                            type="email"
                            disabled
                            value={currentUser?.email || "admin@rematch.go.id"}
                            className="w-full bg-secondary/50 border border-border rounded-md px-3 py-2 text-xs text-muted-foreground cursor-not-allowed"
                          />
                          <span className="text-[10px] text-muted-foreground">
                            {t("settings.emailSsoHelp")}
                          </span>
                        </label>
                      </div>

                      <DialogFooter className="gap-2 sm:gap-0">
                        <DialogClose asChild>
                          <button
                            type="button"
                            className="px-3 py-1.5 rounded-md border border-border text-xs font-medium text-foreground hover:bg-secondary"
                          >
                            {t("common.cancel")}
                          </button>
                        </DialogClose>
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditProfileOpen(false);
                            toast.success(t("settings.profileUpdated"));
                          }}
                          className="px-3 py-1.5 rounded-md bg-brand text-brand-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
                        >
                          {t("common.saveChanges")}
                        </button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
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
                        {currentUser?.name || t("auth.defaultAdmin")}
                      </h4>
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand capitalize">
                        <Shield className="size-3" />
                        {currentUser
                          ? t(`auth.role.${currentUser.role}` as Parameters<typeof t>[0]) ||
                            currentUser.role
                          : t("auth.defaultAdmin")}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate">
                      <Mail className="size-3.5 shrink-0" />
                      <span>{currentUser?.email || "admin@rematch.go.id"}</span>
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/20 p-4">
                    <Building2 className="size-4 shrink-0 text-muted-foreground mt-0.5" />
                    <div className="min-w-0 space-y-0.5">
                      <span className="text-[11px] font-medium text-muted-foreground block">
                        {t("settings.organization")}
                      </span>
                      <p className="text-xs font-semibold text-foreground truncate">
                        {t("brand.organization")}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/20 p-4">
                    <Building2 className="size-4 shrink-0 text-muted-foreground mt-0.5" />
                    <div className="min-w-0 space-y-0.5">
                      <span className="text-[11px] font-medium text-muted-foreground block">
                        {t("settings.organizationUnit")}
                      </span>
                      <p className="text-xs font-semibold text-foreground truncate">
                        {t("brand.organizationUnit")}
                      </p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-6 space-y-6">
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {t("settings.preferencesTitle")}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.preferencesDescription")}
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

              <Card className="p-6 space-y-5">
                <div>
                  <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <KeyRound className="size-4 text-brand" />
                    <span>{t("settings.accountSecurity")}</span>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.accountSecurityDesc")}
                  </p>
                </div>

                <div className="space-y-3.5 max-w-md">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-foreground">{t("settings.oldPassword")}</span>
                    <input
                      type="password"
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                      placeholder={t("settings.oldPasswordPlaceholder")}
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-foreground">{t("settings.newPassword")}</span>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={t("settings.newPasswordPlaceholder")}
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-foreground">{t("settings.confirmPassword")}</span>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={t("settings.confirmPasswordPlaceholder")}
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                  </label>

                  <div className="pt-1">
                    <button
                      type="button"
                      disabled={isUpdatingPassword}
                      onClick={handleUpdatePassword}
                      className="inline-flex items-center gap-2 rounded-md bg-brand px-3.5 py-2 text-xs font-semibold text-brand-foreground hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer shadow-xs"
                    >
                      {isUpdatingPassword ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <KeyRound className="size-3.5" />
                      )}
                      <span>{t("settings.updatePassword")}</span>
                    </button>
                  </div>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="engine" className="mt-0 space-y-6">
              <Card className="p-6 space-y-5">
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {t("settings.matchingDefaults")}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.matchingDefaultsDesc")}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                </div>
              </Card>

              <Card className="p-6 space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <SlidersHorizontal className="size-4 text-brand" />
                    <span>{t("settings.customStopwords")}</span>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.customStopwordsDesc")}
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
                    placeholder="pt, cv, tbk, persero, perseroda, jalan, no, nomor, gedung, lantai..."
                    className="w-full rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand leading-relaxed"
                  />
                  <p className="text-[11px] text-muted-foreground italic">
                    {t("settings.customStopwordsExample")}
                  </p>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="keamanan" forceMount className="mt-0 space-y-6 data-[state=inactive]:hidden">
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

              <SettingsSection
                title={t("settings.dataPrivacy")}
                description={t("settings.dataPrivacyDesc")}
              >
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

              <Card className="p-6 space-y-4">
                <div>
                  <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <Lock className="size-4 text-brand" />
                    <span>{t("settings.autoCleanup")}</span>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.autoCleanupDesc")}
                  </p>
                </div>

                <div className="max-w-md">
                  <Select
                    label={t("settings.retentionSchedule")}
                    value={privacy.autoCleanup}
                    onChange={(val) => setPrivacy((current) => ({ ...current, autoCleanup: val }))}
                    options={[
                      t("settings.retention7Days"),
                      t("settings.retention14Days"),
                      t("settings.retention30Days"),
                      t("settings.retentionNever"),
                    ]}
                  />
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="ekspor" forceMount className="mt-0 space-y-6 data-[state=inactive]:hidden">
              <Card className="p-6 space-y-5">
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {t("settings.exportDefaults")}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.exportDefaultsDesc")}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label={t("settings.defaultExportFormat")}
                    value={exportPreferences.exportFormat}
                    onChange={(val) =>
                      setExportPreferences((current) => ({ ...current, exportFormat: val }))
                    }
                    options={["Excel (.xlsx)", "CSV (.csv)", "JSON (.json)", "Parquet (.parquet)"]}
                  />

                  <Select
                    label={t("settings.csvDelimiter")}
                    value={exportPreferences.csvDelimiter}
                    onChange={(val) =>
                      setExportPreferences((current) => ({ ...current, csvDelimiter: val }))
                    }
                    options={[t("settings.csvComma"), t("settings.csvSemicolon")]}
                  />
                </div>

                <p className="text-[11px] text-muted-foreground">
                  {t("settings.csvDelimiterDesc")}
                </p>
              </Card>

              <SettingsSection
                title={t("settings.exportMetadata")}
                description={t("settings.exportMetadataDesc")}
              >
                <Toggle
                  label={t("settings.includeReferenceKey")}
                  checked={exportPreferences.includeReferenceKey}
                  onChange={(checked) =>
                    setExportPreferences((current) => ({
                      ...current,
                      includeReferenceKey: checked,
                    }))
                  }
                />
                <Toggle
                  label={t("settings.includeAuditTrail")}
                  checked={exportPreferences.includeAuditTrail}
                  onChange={(checked) =>
                    setExportPreferences((current) => ({
                      ...current,
                      includeAuditTrail: checked,
                    }))
                  }
                />
                <Toggle
                  label={t("settings.includeScore")}
                  checked={exportPreferences.includeScore}
                  onChange={(checked) =>
                    setExportPreferences((current) => ({ ...current, includeScore: checked }))
                  }
                />
              </SettingsSection>
            </TabsContent>

            {settingsError && (
              <ErrorPanel
                title={t("feedback.error.title")}
                description={settingsError}
                action={
                  <button
                    onClick={() => setSettingsError(null)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary cursor-pointer"
                  >
                    {t("common.tryAgain")}
                  </button>
                }
              />
            )}

            {saving && (
              <LoadingPanel
                title={t("feedback.loading.title")}
                description={t("feedback.loading.desc")}
              />
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDiscardOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-secondary transition-colors cursor-pointer"
              >
                <RotateCcw className="size-3.5 text-muted-foreground" />
                <span>{t("common.discard")}</span>
              </button>
              <button
                type="button"
                onClick={saveLocalState}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-brand-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity cursor-pointer shadow-xs"
              >
                <Save className="size-3.5" />
                <span>{t("common.saveChanges")}</span>
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
