import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { AppLayout } from "./components/app-layout";
import { Loader2 } from "lucide-react";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    defaultPendingComponent: () => (
      <AppLayout>
        <div className="flex min-h-40 items-center justify-center" role="status" aria-label="Loading">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    ),
    defaultPreloadStaleTime: 5 * 60 * 1000,
  });

  return router;
};
