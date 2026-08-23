import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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

const AUTH_STORAGE_KEY = "rematch_auth_session";

function getStoredSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.user) {
      return parsed as AuthSession;
    }
  } catch {
    // Ignore JSON errors
  }
  return null;
}

function setStoredSession(session: AuthSession | null) {
  if (typeof window === "undefined") return;
  try {
    if (session) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    return getStoredSession()?.user ?? null;
  });
  const [permissions, setPermissions] = useState<PermissionName[]>(() => {
    return getStoredSession()?.permissions ?? [];
  });
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return !getStoredSession();
  });
  const currentUserRef = useRef<AuthUser | null>(currentUser);
  const bootstrapStartedRef = useRef(false);
  const refreshRequestVersionRef = useRef(0);
  const inFlightRefreshRef = useRef<Promise<AuthUser | null> | null>(null);

  const applySession = useCallback((session: AuthSession | null) => {
    setCurrentUser(session?.user ?? null);
    setPermissions(session?.permissions ?? []);
    setStoredSession(session);
  }, []);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  const invalidateAuthRefreshes = useCallback(() => {
    refreshRequestVersionRef.current += 1;
    inFlightRefreshRef.current = null;
  }, []);

  const refreshCurrentUser = useCallback(async () => {
    if (inFlightRefreshRef.current) {
      return inFlightRefreshRef.current;
    }

    const requestVersion = refreshRequestVersionRef.current + 1;
    refreshRequestVersionRef.current = requestVersion;

    const refreshPromise: Promise<AuthUser | null> = (async () => {
      try {
        const session = await fetchCurrentUser();
        if (refreshRequestVersionRef.current === requestVersion) {
          applySession(session);
        }
        return session?.user ?? null;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          if (refreshRequestVersionRef.current === requestVersion) {
            applySession(null);
          }
          return null;
        }

        return currentUserRef.current;
      } finally {
        if (refreshRequestVersionRef.current === requestVersion) {
          setIsLoadingAuth(false);
        }
        inFlightRefreshRef.current = null;
      }
    })();

    inFlightRefreshRef.current = refreshPromise;
    return refreshPromise;
  }, [applySession]);

  useEffect(() => {
    // Hydrate from localStorage immediately if not already initialized
    const stored = getStoredSession();
    if (stored && !currentUserRef.current) {
      applySession(stored);
      setIsLoadingAuth(false);
    }
  }, [applySession]);

  useEffect(() => {
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;
    void refreshCurrentUser();
  }, [refreshCurrentUser]);

  useEffect(() => {
    const handleUnauthorized = () => {
      invalidateAuthRefreshes();
      applySession(null);
      setIsLoadingAuth(false);
    };

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [applySession, invalidateAuthRefreshes]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === AUTH_STORAGE_KEY) {
        const stored = getStoredSession();
        applySession(stored);
        setIsLoadingAuth(false);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [applySession]);

  const login = useCallback(async (input: { email: string; password: string }): Promise<AuthResult> => {
    try {
      const session = await loginWithSession(input);
      invalidateAuthRefreshes();
      applySession(session);
      setIsLoadingAuth(false);
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401 || error.status === 422) {
          invalidateAuthRefreshes();
          applySession(null);
          setIsLoadingAuth(false);
          return { ok: false, error: error.message || "Email or password is incorrect" };
        }
        return { ok: false, error: "Unable to connect to the server" };
      }

      return { ok: false, error: "Unable to connect to the server" };
    }
  }, [applySession, invalidateAuthRefreshes]);

  const logout = useCallback(async () => {
    try {
      await logoutSession();
    } catch {
      // Clear local state even if the session request fails so the UI does not remain stuck.
    } finally {
      invalidateAuthRefreshes();
      applySession(null);
      setIsLoadingAuth(false);
    }
  }, [applySession, invalidateAuthRefreshes]);

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
