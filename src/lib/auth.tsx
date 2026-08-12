import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  AUTH_UNAUTHORIZED_EVENT,
  fetchCurrentUser,
  loginWithSession,
  logoutSession,
  type AuthUser,
  ApiError,
} from "@/lib/api";

type AuthResult = { ok: true } | { ok: false; error: string };

type AuthContextValue = {
  currentUser: AuthUser | null;
  isAuthenticated: boolean;
  isLoadingAuth: boolean;
  login: (input: { email: string; password: string }) => Promise<AuthResult>;
  logout: () => Promise<void>;
  refreshCurrentUser: () => Promise<AuthUser | null>;
  user: AuthUser | null;
  hydrated: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const refreshCurrentUser = useCallback(async () => {
    setIsLoadingAuth(true);
    try {
      const user = await fetchCurrentUser();
      setCurrentUser(user);
      return user;
    } catch {
      setCurrentUser(null);
      return null;
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    void refreshCurrentUser();
  }, [refreshCurrentUser]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setCurrentUser(null);
      setIsLoadingAuth(false);
    };

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  const login = useCallback(async (input: { email: string; password: string }): Promise<AuthResult> => {
    try {
      const user = await loginWithSession(input);
      setCurrentUser(user);
      return { ok: true };
    } catch (error) {
      setCurrentUser(null);
      if (error instanceof ApiError) {
        if (error.status === 401 || error.status === 422) {
          return { ok: false, error: error.message || "Email or password is incorrect" };
        }
        return { ok: false, error: "Unable to connect to the server" };
      }

      return { ok: false, error: "Unable to connect to the server" };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutSession();
    } catch {
      // Clear local state even if the session request fails so the UI does not remain stuck.
    } finally {
      setCurrentUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser,
      isAuthenticated: Boolean(currentUser),
      isLoadingAuth,
      login,
      logout,
      refreshCurrentUser,
      user: currentUser,
      hydrated: !isLoadingAuth,
    }),
    [currentUser, isLoadingAuth, login, logout, refreshCurrentUser],
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
