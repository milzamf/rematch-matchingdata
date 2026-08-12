import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  GitCompareArrows,
  ClipboardCheck,
  Settings as SettingsIcon,
} from "lucide-react";

import { getInitials, useAuth } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/authorization";
import { usePreferences } from "@/lib/preferences";

const nav = [
  { labelKey: "nav.dashboard", url: "/", icon: LayoutDashboard, permission: PERMISSIONS.DASHBOARD_VIEW },
  { labelKey: "nav.matching", url: "/matching", icon: GitCompareArrows, permission: PERMISSIONS.MATCHING_VIEW },
  { labelKey: "nav.results", url: "/results", icon: ClipboardCheck, permission: PERMISSIONS.EXPORT_VIEW },
  { labelKey: "nav.settings", url: "/settings", icon: SettingsIcon },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { t } = usePreferences();
  const { can, currentUser } = useAuth();
  const visibleNav = nav.filter((item) => !item.permission || can(item.permission));

  return (
    <aside className="hidden lg:flex w-60 shrink-0 border-r border-border bg-sidebar flex-col sticky top-0 h-screen">
      <div className="px-5 h-16 flex items-center gap-2.5 border-b border-border">
        <div className="size-8 bg-brand rounded-lg grid place-items-center">
          <div className="size-3 bg-brand-foreground rounded-[3px]" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-semibold text-[15px] tracking-tight text-foreground">RE-MATCH</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("brand.subtitle")}
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {visibleNav.map((item) => {
          const active = item.url === "/" ? pathname === "/" : pathname.startsWith(item.url);
          const Icon = item.icon;
          return (
            <Link
              key={item.url}
              to={item.url}
              className={[
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              ].join(" ")}
            >
              <Icon className="size-4" />
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        {currentUser ? (
          <div className="flex items-center gap-3 rounded-lg bg-secondary/30 px-3 py-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-background text-xs font-semibold text-foreground">
              {getInitials(currentUser.name)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{currentUser.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{currentUser.email}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {t(`auth.role.${currentUser.role}` as Parameters<typeof t>[0])}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
