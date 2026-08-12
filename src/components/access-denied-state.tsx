import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { usePreferences } from "@/lib/preferences";

export function AccessDeniedState() {
  const { t } = usePreferences();

  return (
    <div className="rounded-lg border border-border bg-card">
      <EmptyState
        icon={ShieldAlert}
        title={t("access.denied.title")}
        description={t("access.denied.description")}
        action={
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90"
          >
            {t("access.denied.back")}
          </Link>
        }
      />
    </div>
  );
}
