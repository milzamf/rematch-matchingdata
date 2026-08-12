import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { usePreferences } from "@/lib/preferences";

export function Topbar() {
  const { t } = usePreferences();

  return (
    <header className="h-16 border-b border-border bg-card sticky top-0 z-20 flex items-center justify-between px-6 gap-4">
      <div className="min-w-0" />

      <div className="flex items-center gap-2">
        <Link
          to="/matching"
          className="inline-flex items-center gap-1.5 rounded-md bg-brand text-brand-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="size-4" />
          {t("topbar.newMatching")}
        </Link>
      </div>
    </header>
  );
}
