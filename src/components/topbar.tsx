import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Plus } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/authorization";
import { usePreferences } from "@/lib/preferences";
import { LogoutDialog } from "@/components/logout-dialog";

export function Topbar() {
  const { t } = usePreferences();
  const { can, logout } = useAuth();
  const navigate = useNavigate();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleConfirmLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      navigate({ to: "/login", replace: true });
    } finally {
      setIsLoggingOut(false);
      setShowLogoutConfirm(false);
    }
  };

  return (
    <>
      <header className="h-16 border-b border-border bg-card sticky top-0 z-20 flex items-center justify-between px-6 gap-4">
        <div className="min-w-0" />

        <div className="flex items-center gap-2">
          {can(PERMISSIONS.MATCHING_CREATE) && (
            <Link
              to="/matching"
              className="inline-flex items-center gap-1.5 rounded-md bg-brand text-brand-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer active:scale-95 shadow-xs"
            >
              <Plus className="size-4" />
              {t("topbar.newMatching")}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-destructive/30 cursor-pointer active:scale-95 transition-all duration-150 shadow-xs"
            title={t("auth.logout")}
          >
            <LogOut className="size-4 text-muted-foreground group-hover:text-destructive group-hover:-translate-x-0.5 transition-all" />
            <span>{t("auth.logout")}</span>
          </button>
        </div>
      </header>

      <LogoutDialog
        open={showLogoutConfirm}
        onOpenChange={setShowLogoutConfirm}
        onConfirm={handleConfirmLogout}
        isLoading={isLoggingOut}
      />
    </>
  );
}
