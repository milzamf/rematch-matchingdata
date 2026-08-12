import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  AUTH_UNAUTHORIZED_EVENT,
  fetchCurrentUser,
  loginWithSession,
  logoutSession,
  type AuthSession,
  type AuthUser,
  ApiError,
} from "@/lib/api";
import { hasPermission, type PermissionName, type UserRole } from "@/lib/authorization";

type AuthResult = { ok: true } | { ok: false; error: string };

type AuthContextValue = {
  currentUser: AuthUser | null;
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  login: (input: { email: string; password: string }) => Promise<AuthResult>;
  logout: () => Promise<void>;
  refreshCurrentUser: () => Promise<AuthUser | null>;
  permissions: PermissionName[];
  role: UserRole | null;
  can: (permission: PermissionName) => boolean;
  user: AuthUser | null;
  hydrated: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<PermissionName[]>([]);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const applySession = useCallback((session: AuthSession | null) => {
    setCurrentUser(session?.user ?? null);
    setPermissions(session?.permissions ?? []);
  }, []);

  const refreshCurrentUser = useCallback(async () => {
    setIsLoadingAuth(true);
    try {
      const session = await fetchCurrentUser();
      applySession(session);
      return session?.user ?? null;
    } catch {
      applySession(null);
      return null;
    } finally {
      setIsLoadingAuth(false);
    }
  }, [applySession]);

  useEffect(() => {
    void refreshCurrentUser();
  }, [refreshCurrentUser]);

  useEffect(() => {
    const handleUnauthorized = () => {
      applySession(null);
      setIsLoadingAuth(false);
    };

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [applySession]);

  const login = useCallback(async (input: { email: string; password: string }): Promise<AuthResult> => {
    try {
      const session = await loginWithSession(input);
      applySession(session);
      return { ok: true };
    } catch (error) {
      applySession(null);
      if (error instanceof ApiError) {
        if (error.status === 401 || error.status === 422) {
          return { ok: false, error: error.message || "Email or password is incorrect" };
        }
        return { ok: false, error: "Unable to connect to the server" };
      }

      return { ok: false, error: "Unable to connect to the server" };
    }
  }, [applySession]);

  const logout = useCallback(async () => {
    try {
      await logoutSession();
    } catch {
      // Clear local state even if the session request fails so the UI does not remain stuck.
    } finally {
      applySession(null);
    }
  }, [applySession]);

  const can = useCallback(
    (permission: PermissionName) => hasPermission(permissions, permission),
    [permissions],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      can,
      currentUser,
      isAuthenticated: Boolean(currentUser),
      isLoadingAuth,
      login,
      logout,
      permissions,
      refreshCurrentUser,
      role: currentUser?.role ?? null,
      user: currentUser,
      hydrated: !isLoadingAuth,
    }),
    [can, currentUser, isLoadingAuth, login, logout, permissions, refreshCurrentUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
