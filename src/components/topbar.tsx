import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Plus } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/authorization";
import { usePreferences } from "@/lib/preferences";

export function Topbar() {
  const { t } = usePreferences();
  const { can, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate({ to: "/login", replace: true });
  };

  return (
    <header className="h-16 border-b border-border bg-card sticky top-0 z-20 flex items-center justify-between px-6 gap-4">
      <div className="min-w-0" />

      <div className="flex items-center gap-2">
        {can(PERMISSIONS.MATCHING_CREATE) && (
          <Link
            to="/matching"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand text-brand-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="size-4" />
            {t("topbar.newMatching")}
          </Link>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary/60 transition-colors"
        >
          <LogOut className="size-4" />
          {t("auth.logout")}
        </button>
      </div>
    </header>
  );
}
