import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Plus } from "lucide-react";

import { getInitials, useAuth } from "@/lib/auth";
import { usePreferences } from "@/lib/preferences";

export function Topbar() {
  const { t } = usePreferences();
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate({ to: "/login", replace: true });
  };

  return (
    <header className="h-16 border-b border-border bg-card sticky top-0 z-20 flex items-center justify-between px-6 gap-4">
      <div className="min-w-0" />

      <div className="flex items-center gap-2">
        {currentUser && (
          <div className="hidden sm:flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
            <div className="size-8 rounded-full bg-secondary text-secondary-foreground grid place-items-center text-[11px] font-semibold">
              {getInitials(currentUser.name)}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground truncate max-w-40">
                {currentUser.name}
              </p>
              <p className="text-[11px] text-muted-foreground truncate max-w-40">
                {currentUser.email}
              </p>
            </div>
          </div>
        )}
        <Link
          to="/matching"
          className="inline-flex items-center gap-1.5 rounded-md bg-brand text-brand-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="size-4" />
          {t("topbar.newMatching")}
        </Link>
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
