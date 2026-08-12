import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/lib/auth";
import { PreferencesProvider, usePreferences } from "@/lib/preferences";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  const { t } = usePreferences();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("error.notFound.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("error.notFound.description")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.goHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = usePreferences();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("error.load.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("error.load.description")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.tryAgain")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("common.goHome")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Dashboard - RE-MATCH" },
      {
        name: "description",
        content: "RE-MATCH digunakan untuk rekonsiliasi dan pencocokan data usaha/perusahaan",
      },
      { property: "og:title", content: "Dashboard - RE-MATCH" },
      {
        property: "og:description",
        content: "Rekonsiliasi dan pencocokan data usaha/perusahaan",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Dashboard - RE-MATCH" },
      { name: "description", content: "Aplikasi untuk rekonsiliasi dan pencocokan data" },
      { property: "og:description", content: "Aplikasi untuk rekonsiliasi dan pencocokan data" },
      { name: "twitter:description", content: "Aplikasi untuk rekonsiliasi dan pencocokan data" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/35312d90-fd8e-416f-8654-badeef74c181/id-preview-7ff6454e--16ba287d-55ad-4100-95c0-217989a9f226.lovable.app-1783244634262.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/35312d90-fd8e-416f-8654-badeef74c181/id-preview-7ff6454e--16ba287d-55ad-4100-95c0-217989a9f226.lovable.app-1783244634262.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <PreferencesProvider>
          {children}
          <Toaster closeButton position="top-right" richColors />
        </PreferencesProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </AuthProvider>
    </QueryClientProvider>
  );
}
