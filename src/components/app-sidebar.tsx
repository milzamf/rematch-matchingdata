import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  GitCompareArrows,
  ClipboardCheck,
  Settings as SettingsIcon,
} from "lucide-react";

import { useAuth, getInitials } from "@/lib/auth";

const nav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Matching", url: "/matching", icon: GitCompareArrows },
  { title: "Results", url: "/results", icon: ClipboardCheck },
  { title: "Settings", url: "/settings", icon: SettingsIcon },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { user } = useAuth();
  const initials = user ? getInitials(user.fullName) : "??";

  return (
    <aside className="hidden lg:flex w-60 shrink-0 border-r border-border bg-sidebar flex-col sticky top-0 h-screen">
      <div className="px-5 h-16 flex items-center gap-2.5 border-b border-border">
        <div className="size-8 bg-brand rounded-lg grid place-items-center">
          <div className="size-3 bg-brand-foreground rounded-[3px]" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-semibold text-[15px] tracking-tight text-foreground">BatchMatch</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Data Platform</span>
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
              <span>{item.title}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2.5 px-2">
          <div className="size-8 rounded-full bg-brand text-brand-foreground grid place-items-center text-xs font-semibold">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">{user?.fullName ?? "Guest"}</p>
            <p className="text-[10px] text-muted-foreground truncate">
              @{user?.username ?? "guest"}
            </p>
          </div>
        </div>
      </div>

    </aside>
  );
}
