import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  GitCompareArrows,
  ClipboardCheck,
  Settings as SettingsIcon,
} from "lucide-react";

import { usePreferences } from "@/lib/preferences";

const nav = [
  { labelKey: "nav.dashboard", url: "/", icon: LayoutDashboard },
  { labelKey: "nav.matching", url: "/matching", icon: GitCompareArrows },
  { labelKey: "nav.results", url: "/results", icon: ClipboardCheck },
  { labelKey: "nav.settings", url: "/settings", icon: SettingsIcon },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { t } = usePreferences();

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
        {nav.map((item) => {
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
        <div className="px-2 text-[10px] leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">RE-MATCH</p>
          <p>{t("brand.organizationUnit")}</p>
          <p>{t("brand.organization")}</p>
        </div>
      </div>
    </aside>
  );
}
