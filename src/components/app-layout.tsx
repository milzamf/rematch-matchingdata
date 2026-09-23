import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { AppSidebar } from "./app-sidebar";
import { Topbar } from "./topbar";
import { useAuth } from "@/lib/auth";
import { SidebarProvider } from "@/lib/sidebar-context";

export function AppLayout({ children }: { children: ReactNode }) {
  const { currentUser, isLoadingAuth } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoadingAuth && !currentUser) {
      navigate({ to: "/login", replace: true });
    }
  }, [currentUser, isLoadingAuth, navigate]);

  if (isLoadingAuth || !currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="h-screen w-full flex bg-background text-foreground overflow-hidden">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 w-full focus:outline-none">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5 sm:gap-4 mb-3.5 sm:mb-8">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg sm:text-2xl font-semibold tracking-tight text-foreground break-words">{title}</h1>
        {description && (
          <p className="mt-0.5 sm:mt-1 text-[11px] sm:text-sm text-muted-foreground leading-relaxed break-words">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-card rounded-lg sm:rounded-xl border border-border shadow-xs min-w-0 max-w-full ${className}`}>
      {children}
    </div>
  );
}
