import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { LogOut, Plus, Menu, User, Settings, SlidersHorizontal, Moon, Sun, Laptop, PanelLeft, PanelLeftOpen } from "lucide-react";

import { getInitials, useAuth } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/authorization";
import { usePreferences } from "@/lib/preferences";
import { LogoutDialog } from "@/components/logout-dialog";
import { Logo, LogoIcon } from "@/components/ui/logo";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { nav, secondaryNav } from "@/components/app-sidebar";
import { useSidebarContext } from "@/lib/sidebar-context";
import { workspaceSharingEnabled } from "@/lib/workspace-access";

export function Topbar() {
  const { t, theme, setTheme, resolvedTheme, language, setLanguage } = usePreferences();
  const { can, currentUser, logout } = useAuth();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const { isCollapsed, toggleSidebar, isMobileOpen, setMobileOpen } = useSidebarContext();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const visibleNav = nav.filter((item) => !("permission" in item) || can(item.permission));
  const visibleSecondaryNav = secondaryNav.filter((item) => can(item.permission));

  const currentRouteTitle = (() => {
    if (pathname === "/") return t("nav.dashboard");
    const allNavs = [...nav, ...secondaryNav];
    const match = allNavs.find((item) => item.url !== "/" && pathname.startsWith(item.url));
    if (match) return t(match.labelKey);
    if (pathname.startsWith("/workspaces")) return t("workspace.title") || "Workspaces";
    return "";
  })();

  const handleConfirmLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      navigate({ to: "/login", replace: true });
    } finally {
      setIsLoggingOut(false);
      setShowLogoutConfirm(false);
      setMobileOpen(false);
    }
  };

  const handleNavClick = (url: string) => {
    setMobileOpen(false);
    navigate({ to: url });
  };

  return (
    <>
      <header className="h-14 sm:h-16 border-b border-border bg-card shrink-0 flex items-center justify-between px-3 sm:px-6 gap-2 sm:gap-4 w-full max-w-full">
        <div className="min-w-0 flex items-center gap-1 sm:gap-2">
          {/* Mobile hamburger menu toggle */}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden h-10 w-10 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary active:scale-95 transition-all cursor-pointer shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Buka Menu Navigasi"
          >
            <Menu className="size-5" />
          </button>

          <div className="lg:hidden flex items-center min-w-0">
            <Logo variant="horizontal" size="sm" showDirectorate={false} />
          </div>

          {/* Desktop sidebar toggle button (Buka / Tutup Sidebar) */}
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden lg:flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary active:scale-95 transition-all cursor-pointer shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            title={isCollapsed ? `${t("common.expand") || "Buka Sidebar"} (Ctrl+B)` : `${t("common.collapse") || "Ciutkan Sidebar"} (Ctrl+B)`}
            aria-label={isCollapsed ? "Buka Sidebar" : "Ciutkan Sidebar"}
            data-testid="topbar-sidebar-toggle-btn"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="size-4.5" />
            ) : (
              <PanelLeft className="size-4.5" />
            )}
          </button>

          {/* Desktop breadcrumb indicator when sidebar is collapsed */}
          {isCollapsed && currentRouteTitle && (
            <div className="hidden lg:flex items-center gap-2 text-xs font-medium text-muted-foreground pl-1.5 animate-in fade-in-50 duration-200">
              <span className="font-bold text-foreground tracking-tight">RE-MATCH</span>
              <span className="text-muted-foreground/40 font-normal">/</span>
              <span className="text-foreground/90 font-medium truncate max-w-[220px]">
                {currentRouteTitle}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {!workspaceSharingEnabled && can(PERMISSIONS.MATCHING_CREATE) && (
            <Link
              to="/matching"
              className="inline-flex items-center gap-1 sm:gap-1.5 rounded-md bg-brand text-brand-foreground px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer active:scale-95 shadow-xs min-h-[36px]"
            >
              <Plus className="size-3.5 sm:size-4" />
              <span className="hidden sm:inline">{t("topbar.newMatching")}</span>
              <span className="sm:hidden font-semibold">Baru</span>
            </Link>
          )}

          {/* Quick theme toggle */}
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="group inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-secondary active:scale-95 transition-all cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring shrink-0 shadow-xs"
            title={resolvedTheme === "dark" ? "Ganti ke mode terang (Light mode)" : "Ganti ke mode gelap (Dark mode)"}
            aria-label="Toggle tema terang/gelap"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="size-4 text-amber-500 transition-transform group-hover:rotate-45" />
            ) : (
              <Moon className="size-4 text-slate-700 transition-transform group-hover:-rotate-12" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="group inline-flex items-center justify-center gap-1 sm:gap-1.5 rounded-md border border-border bg-background px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-destructive/30 cursor-pointer active:scale-95 transition-all duration-150 shadow-xs min-h-[36px]"
            title={t("auth.logout")}
          >
            <LogOut className="size-3.5 sm:size-4 text-muted-foreground group-hover:text-destructive group-hover:-translate-x-0.5 transition-all" />
            <span className="hidden sm:inline">{t("auth.logout")}</span>
          </button>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      <Sheet open={isMobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-xs p-0 flex flex-col h-full bg-sidebar border-r border-border">
          <SheetHeader className="p-4 border-b border-border text-left">
            <SheetTitle className="sr-only">Navigasi Utama</SheetTitle>
            <div className="flex items-center gap-3">
              <LogoIcon className="w-8 h-8 shrink-0" />
              <div className="flex flex-col leading-tight min-w-0">
                <span className="font-extrabold text-[15px] tracking-tight text-foreground">
                  RE-<span className="text-brand">MATCH</span>
                </span>
                <span
                  className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground truncate"
                  title={t("brand.subtitle")}
                >
                  {t("brand.subtitle")}
                </span>
              </div>
            </div>
          </SheetHeader>

          {/* User profile banner in mobile drawer */}
          {currentUser && (
            <div className="p-4 border-b border-border/70 bg-card/60">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 shrink-0 border border-border/60">
                  <AvatarImage alt={currentUser.name} src={currentUser.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-brand/10 text-brand font-semibold text-xs">
                    {getInitials(currentUser.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate leading-tight">
                    {currentUser.name || "Administrator"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
                    {currentUser.email}
                  </p>
                  <div className="mt-1">
                    <span className="inline-flex items-center rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand capitalize">
                      {t(`auth.role.${currentUser.role}` as Parameters<typeof t>[0]) || currentUser.role}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation links */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Menu Utama
            </p>
            {visibleNav.map((item) => {
              const active = item.url === "/" ? pathname === "/" : pathname.startsWith(item.url);
              const Icon = item.icon;
              return (
                <button
                  key={item.url}
                  type="button"
                  onClick={() => handleNavClick(item.url)}
                  className={[
                    "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer text-left",
                    active
                      ? "bg-secondary text-foreground font-semibold"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{t(item.labelKey)}</span>
                </button>
              );
            })}

            {visibleSecondaryNav.length > 0 && (
              <div className="mt-5 pt-4 border-t border-border/50">
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("nav.roleArea")}
                </p>
                <div className="space-y-1">
                  {visibleSecondaryNav.map((item) => {
                    const active = pathname.startsWith(item.url);
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.url}
                        type="button"
                        onClick={() => handleNavClick(item.url)}
                        className={[
                          "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer text-left",
                          active
                            ? "bg-secondary text-foreground font-semibold"
                            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                        ].join(" ")}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </nav>

          {/* Bottom Settings & Preferences in Mobile Drawer */}
          <div className="p-3 border-t border-border bg-card/40 space-y-2">
            {/* Quick theme & language toggles */}
            <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
              <span className="font-medium">Tema</span>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`p-1 rounded ${theme === "light" ? "bg-secondary text-foreground font-semibold" : "text-muted-foreground"}`}
                  title="Terang"
                >
                  <Sun className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`p-1 rounded ${theme === "dark" ? "bg-secondary text-foreground font-semibold" : "text-muted-foreground"}`}
                  title="Gelap"
                >
                  <Moon className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("system")}
                  className={`p-1 rounded ${theme === "system" ? "bg-secondary text-foreground font-semibold" : "text-muted-foreground"}`}
                  title="Sistem"
                >
                  <Laptop className="size-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between px-2 py-1 text-xs text-muted-foreground">
              <span className="font-medium">Bahasa</span>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5 text-[11px] font-medium">
                <button
                  type="button"
                  onClick={() => setLanguage("id")}
                  className={`px-2 py-0.5 rounded ${language === "id" ? "bg-brand text-brand-foreground font-semibold" : "text-muted-foreground"}`}
                >
                  ID
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage("en")}
                  className={`px-2 py-0.5 rounded ${language === "en" ? "bg-brand text-brand-foreground font-semibold" : "text-muted-foreground"}`}
                >
                  EN
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowLogoutConfirm(true);
              }}
              className="flex items-center justify-center gap-2 w-full p-2.5 rounded-lg text-xs font-semibold text-destructive hover:bg-destructive/10 active:scale-95 transition-all cursor-pointer border border-destructive/20 mt-1"
            >
              <LogOut className="size-3.5" />
              <span>{t("auth.logout") ?? "Keluar"}</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <LogoutDialog
        open={showLogoutConfirm}
        onOpenChange={setShowLogoutConfirm}
        onConfirm={handleConfirmLogout}
        isLoading={isLoggingOut}
      />
    </>
  );
}
