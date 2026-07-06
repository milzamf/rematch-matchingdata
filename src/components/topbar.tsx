import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  ChevronDown,
  HelpCircle,
  LogOut,
  Plus,
  Search,
  Settings as SettingsIcon,
} from "lucide-react";

import { useAuth, getInitials } from "@/lib/auth";
import { usePreferences } from "@/lib/preferences";

export function Topbar() {
  const { user, logout } = useAuth();
  const { t } = usePreferences();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const initials = user ? getInitials(user.fullName) : "??";

  return (
    <header className="h-16 border-b border-border bg-card sticky top-0 z-20 flex items-center justify-between px-6 gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="hidden md:flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground w-64">
          <Search className="size-3.5" />
          <span>{t("topbar.search")}</span>
          <kbd className="ml-auto text-[10px] font-mono bg-secondary px-1 rounded">Ctrl K</kbd>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link
          to="/matching"
          className="inline-flex items-center gap-1.5 rounded-md bg-brand text-brand-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="size-4" />
          {t("topbar.newMatching")}
        </Link>
        <button
          className="size-9 grid place-items-center rounded-md hover:bg-secondary text-muted-foreground relative"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
          <span className="absolute top-2 right-2 size-1.5 rounded-full bg-accent" />
        </button>
        <button
          className="size-9 grid place-items-center rounded-md hover:bg-secondary text-muted-foreground"
          aria-label="Help"
        >
          <HelpCircle className="size-4" />
        </button>
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 pl-2 pr-2.5 py-1 rounded-md hover:bg-secondary"
            aria-expanded={open}
            aria-haspopup="menu"
          >
            <div className="size-7 rounded-full bg-brand text-brand-foreground grid place-items-center text-[11px] font-semibold">
              {initials}
            </div>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </button>
          {open && user && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-border bg-card shadow-lg z-30 overflow-hidden">
              <div className="px-3 py-3 border-b border-border">
                <p className="text-sm font-semibold truncate">{user.fullName}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              <div className="py-1">
                <button
                  onClick={() => {
                    setOpen(false);
                    navigate({ to: "/settings" });
                  }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary"
                >
                  <SettingsIcon className="size-4" />
                  {t("nav.settings")}
                </button>
                <button
                  onClick={() => {
                    logout();
                    navigate({ to: "/login" });
                  }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary text-destructive"
                >
                  <LogOut className="size-4" />
                  {t("topbar.signOut")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
