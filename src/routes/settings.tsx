import { createFileRoute } from "@tanstack/react-router";
import { AppLayout, PageHeader, Card } from "@/components/app-layout";
import { useAuth, getInitials } from "@/lib/auth";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — BatchMatch" },
      { name: "description", content: "Manage your BatchMatch preferences, profile, and defaults." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  return (
    <AppLayout>
      <div className="px-8 py-8 max-w-[900px] mx-auto">
        <PageHeader
          title="Settings"
          description="Manage your profile, workspace defaults and application preferences."
        />

        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="text-base font-semibold mb-1">Profile</h3>
            <p className="text-sm text-muted-foreground mb-5">
              This information is visible on audit logs and shared exports.
            </p>
            <div className="flex items-center gap-4 mb-5">
              <div className="size-14 rounded-full bg-brand text-brand-foreground grid place-items-center text-lg font-semibold">
                {user ? getInitials(user.fullName) : "??"}
              </div>
              <button className="text-sm font-medium border border-border rounded-md px-3 py-1.5 hover:bg-secondary">
                Change photo
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Full name" defaultValue={user?.fullName ?? ""} />
              <Field label="Username" defaultValue={user?.username ?? ""} />
              <Field label="Email" defaultValue={user?.email ?? ""} />
              <Field label="Timezone" defaultValue="Asia/Jakarta (GMT+7)" />
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-base font-semibold mb-1">Matching Defaults</h3>
            <p className="text-sm text-muted-foreground mb-5">
              New matching jobs will start with these preferences.
            </p>
            <div className="space-y-4">
              <Select
                label="Default preset"
                options={["Balanced", "Strict", "Exploratory", "Custom"]}
              />
              <Select
                label="Default normalization"
                options={["Text Standardization", "Basic", "Entity Name", "Address", "Identifier Strict"]}
              />
              <Field label="Default auto-match threshold" defaultValue="90" />
              <Field label="Default review threshold" defaultValue="70" />
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-base font-semibold mb-1">Preferences</h3>
            <p className="text-sm text-muted-foreground mb-5">
              Notifications and interface options.
            </p>
            <div className="space-y-3">
              <Toggle label="Email me when a job completes" defaultChecked />
              <Toggle label="Show inline data profiling in tables" defaultChecked />
              <Toggle label="Enable keyboard shortcuts (J/K/A/R)" defaultChecked />
              <Toggle label="Beta features" />
            </div>
          </Card>

          <div className="flex justify-end gap-2">
            <button className="px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-secondary">
              Discard
            </button>
            <button className="px-4 py-2 rounded-md bg-brand text-brand-foreground text-sm font-semibold hover:opacity-90">
              Save Changes
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

function Toggle({ label, defaultChecked }: { label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center justify-between py-2 cursor-pointer">
      <span className="text-sm">{label}</span>
      <span className="relative inline-flex">
        <input type="checkbox" defaultChecked={defaultChecked} className="peer sr-only" />
        <span className="h-5 w-9 rounded-full bg-secondary peer-checked:bg-brand transition-colors" />
        <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}
