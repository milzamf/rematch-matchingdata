import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { accessApi, workspaceSharingEnabled } from "@/lib/workspace-access";

export function useWorkspaceAccess(id: string | null) {
  const { currentUser, isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: ["stage5a", "access", currentUser?.id, id],
    queryFn: ({ signal }) => accessApi.permissions(id!, signal),
    enabled: workspaceSharingEnabled && isAuthenticated && !!id,
    retry: false,
    staleTime: 0,
    refetchInterval: 10_000,
    refetchOnWindowFocus: "always",
  });
  // Fail closed after any failed refresh; never keep permissions from a revoked session.
  return { ...query, access: query.isError ? undefined : query.data, actorId: currentUser?.id };
}
