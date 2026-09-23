import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ShieldCheck,
  ChartColumnIncreasing,
  LayoutDashboard,
  GitCompareArrows,
  ClipboardCheck,
  Settings,
  User,
  SlidersHorizontal,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getInitials, useAuth } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/authorization";
import { usePreferences } from "@/lib/preferences";
import { LogoutDialog } from "@/components/logout-dialog";
import { LogoIcon } from "@/components/ui/logo";
import { useSidebarContext } from "@/lib/sidebar-context";
import { cn } from "@/lib/utils";

export const nav = [
  { labelKey: "nav.dashboard", url: "/", icon: LayoutDashboard, permission: PERMISSIONS.DASHBOARD_VIEW },
  { labelKey: "nav.matching", url: "/matching", icon: GitCompareArrows, permission: PERMISSIONS.MATCHING_VIEW },
  { labelKey: "nav.results", url: "/results", icon: ClipboardCheck, permission: PERMISSIONS.EXPORT_VIEW },
  { labelKey: "nav.settings", url: "/settings", icon: Settings },
] as const;

export const secondaryNav = [
  {
    labelKey: "nav.monitoring",
    url: "/monitoring",
    icon: ChartColumnIncreasing,
    permission: PERMISSIONS.MONITORING_VIEW,
  },
  {
    labelKey: "nav.admin",
    url: "/admin",
    icon: ShieldCheck,
    permission: PERMISSIONS.ADMIN_ACCESS,
  },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const { t } = usePreferences();
  const { can, currentUser, logout } = useAuth();
  const { isCollapsed, toggleSidebar } = useSidebarContext();

  const visibleNav = nav.filter((item) => !("permission" in item) || can(item.permission));
  const visibleSecondaryNav = secondaryNav.filter((item) => can(item.permission));

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
    <TooltipProvider delayDuration={150}>
      <aside
        className={cn(
          "hidden lg:flex flex-col h-full shrink-0 border-r border-border bg-sidebar transition-[width] duration-300 ease-in-out select-none",
          isCollapsed ? "w-16" : "w-60"
        )}
      >
        {/* Sidebar Header */}
        <div
          className={cn(
            "h-16 flex items-center border-b border-border shrink-0 transition-all",
            isCollapsed ? "justify-center px-2" : "justify-between px-4"
          )}
        >
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="h-10 w-10 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer group"
                  aria-label="Bentangkan Sidebar"
                  data-testid="sidebar-expand-btn"
                >
                  <LogoIcon className="w-7 h-7 group-hover:scale-105 transition-transform" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={12}>
                <p className="font-semibold text-xs">RE-MATCH</p>
                <p className="text-[10px] text-muted-foreground">
                  {t("common.expand") || "Buka Sidebar"} (Ctrl+B)
                </p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <LogoIcon className="w-8 h-8 shrink-0" />
                <div className="flex flex-col leading-tight min-w-0">
                  <span className="font-extrabold text-[15px] tracking-tight text-foreground truncate">
                    RE-<span className="text-brand">MATCH</span>
                  </span>
                  <span
                    className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground truncate"
                    title={t("brand.subtitle")}
                  >
                    {t("brand.subtitle")}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer shrink-0"
                title={`${t("common.collapse") || "Ciutkan Sidebar"} (Ctrl+B)`}
                aria-label="Ciutkan Sidebar"
                data-testid="sidebar-collapse-btn"
              >
                <PanelLeftClose className="size-4" />
              </button>
            </>
          )}
        </div>

        {/* Navigation Items */}
        <nav
          className={cn(
            "flex-1 py-4 space-y-1 overflow-y-auto overflow-x-hidden min-h-0",
            isCollapsed ? "px-2" : "px-3"
          )}
        >
          {visibleNav.map((item) => {
            const active = item.url === "/" ? pathname === "/" : pathname.startsWith(item.url);
            const Icon = item.icon;

            if (isCollapsed) {
              return (
                <Tooltip key={item.url}>
                  <TooltipTrigger asChild>
                    <Link
                      to={item.url}
                      className={cn(
                        "flex items-center justify-center h-10 w-10 mx-auto rounded-lg transition-colors cursor-pointer",
                        active
                          ? "bg-brand text-brand-foreground shadow-xs font-semibold"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      )}
                      aria-label={t(item.labelKey)}
                    >
                      <Icon className="size-4.5 shrink-0" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12}>
                    <span>{t(item.labelKey)}</span>
                  </TooltipContent>
                </Tooltip>
              );
            }

            return (
              <Link
                key={item.url}
                to={item.url}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                  active
                    ? "bg-secondary text-foreground font-semibold shadow-2xs"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{t(item.labelKey)}</span>
              </Link>
            );
          })}

          {visibleSecondaryNav.length > 0 && (
            <div className={isCollapsed ? "pt-2" : "mt-5 pt-4"}>
              {isCollapsed ? (
                <div className="my-2 border-t border-border mx-1" />
              ) : (
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("nav.roleArea")}
                </p>
              )}
              <div className="space-y-1">
                {visibleSecondaryNav.map((item) => {
                  const active = pathname.startsWith(item.url);
                  const Icon = item.icon;

                  if (isCollapsed) {
                    return (
                      <Tooltip key={item.url}>
                        <TooltipTrigger asChild>
                          <Link
                            to={item.url}
                            className={cn(
                              "flex items-center justify-center h-10 w-10 mx-auto rounded-lg transition-colors cursor-pointer",
                              active
                                ? "bg-brand text-brand-foreground shadow-xs font-semibold"
                                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                            )}
                            aria-label={t(item.labelKey)}
                          >
                            <Icon className="size-4.5 shrink-0" />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={12}>
                          <span>{t(item.labelKey)}</span>
                        </TooltipContent>
                      </Tooltip>
                    );
                  }

                  return (
                    <Link
                      key={item.url}
                      to={item.url}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                        active
                          ? "bg-secondary text-foreground font-semibold shadow-2xs"
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{t(item.labelKey)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </nav>

        {/* User Profile Footer */}
        <div className="p-2 border-t border-border shrink-0">
          {currentUser ? (
            <DropdownMenu>
              {isCollapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="h-10 w-10 flex items-center justify-center rounded-xl hover:bg-secondary/70 transition-colors mx-auto cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <Avatar className="h-8.5 w-8.5 shrink-0 border border-border/60">
                          <AvatarImage alt={currentUser.name} src={currentUser.avatar_url ?? undefined} />
                          <AvatarFallback className="bg-brand/10 text-brand font-semibold text-xs">
                            {getInitials(currentUser.name)}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12}>
                    <p className="font-semibold text-xs">{currentUser.name}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">
                      {t(`auth.role.${currentUser.role}` as Parameters<typeof t>[0]) || currentUser.role}
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-3 w-full p-2 rounded-xl hover:bg-secondary/70 transition-colors text-left group cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <Avatar className="h-9 w-9 shrink-0 border border-border/60">
                      <AvatarImage alt={currentUser.name} src={currentUser.avatar_url ?? undefined} />
                      <AvatarFallback className="bg-brand/10 text-brand font-semibold text-xs">
                        {getInitials(currentUser.name)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate leading-tight">
                        {currentUser.name || "Administrator"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5 capitalize">
                        {t(`auth.role.${currentUser.role}` as Parameters<typeof t>[0]) || currentUser.role || "Admin"}
                      </p>
                    </div>

                    <Settings className="size-4 text-muted-foreground/70 group-hover:text-foreground transition-colors shrink-0" />
                  </button>
                </DropdownMenuTrigger>
              )}

              <DropdownMenuContent
                side={isCollapsed ? "right" : "top"}
                align={isCollapsed ? "end" : "start"}
                sideOffset={isCollapsed ? 12 : 8}
                className="w-64 p-1.5 shadow-xl border-border bg-popover text-popover-foreground rounded-xl"
              >
                <div className="px-2.5 py-2">
                  <p className="text-sm font-semibold text-foreground break-words leading-snug">
                    {currentUser.name}
                  </p>
                  <p className="text-xs text-muted-foreground break-all mt-0.5 leading-tight">
                    {currentUser.email}
                  </p>
                  <div className="mt-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand capitalize">
                      {t(`auth.role.${currentUser.role}` as Parameters<typeof t>[0]) || currentUser.role}
                    </span>
                  </div>
                </div>

                <DropdownMenuSeparator className="my-1" />

                <DropdownMenuItem
                  onClick={() => navigate({ to: "/settings", search: { tab: "akun" } })}
                  className="flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg cursor-pointer hover:bg-secondary focus:bg-secondary"
                >
                  <User className="size-4 text-muted-foreground" />
                  <span>{t("settings.profile") ?? "Pengaturan Profil"}</span>
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => navigate({ to: "/settings", search: { tab: "akun" } })}
                  className="flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg cursor-pointer hover:bg-secondary focus:bg-secondary"
                >
                  <SlidersHorizontal className="size-4 text-muted-foreground" />
                  <span>{t("settings.preferencesTitle") ?? "Preferensi"}</span>
                </DropdownMenuItem>

                <DropdownMenuSeparator className="my-1" />

                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setShowLogoutConfirm(true);
                  }}
                  className="flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg text-destructive hover:bg-destructive/10 focus:bg-destructive/10 focus:text-destructive cursor-pointer transition-colors active:scale-[0.98]"
                >
                  <LogOut className="size-4 text-destructive" />
                  <span className="font-medium">{t("auth.logout") ?? "Keluar"}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <LogoutDialog
          open={showLogoutConfirm}
          onOpenChange={setShowLogoutConfirm}
          onConfirm={handleConfirmLogout}
          isLoading={isLoggingOut}
        />
      </aside>
    </TooltipProvider>
  );
}
