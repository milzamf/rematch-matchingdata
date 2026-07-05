import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type User = {
  id: string;
  username: string;
  fullName: string;
  email: string;
};

type StoredUser = User & { password: string };

type AuthContextValue = {
  user: User | null;
  hydrated: boolean;
  login: (username: string, password: string) => { ok: true } | { ok: false; error: string };
  register: (input: {
    fullName: string;
    username: string;
    email: string;
    password: string;
  }) => { ok: true } | { ok: false; error: string };
  logout: () => void;
  resetRequest: (email: string) => { ok: true } | { ok: false; error: string };
};

const AuthContext = createContext<AuthContextValue | null>(null);

const USERS_KEY = "batchmatch:users";
const SESSION_KEY = "batchmatch:session";

function readUsers(): StoredUser[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    if (!raw) {
      // Seed a demo account
      const demo: StoredUser = {
        id: "u_demo",
        username: "demo",
        fullName: "Andi Setiawan",
        email: "andi@demo.id",
        password: "demo1234",
      };
      window.localStorage.setItem(USERS_KEY, JSON.stringify([demo]));
      return [demo];
    }
    return JSON.parse(raw) as StoredUser[];
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]) {
  window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    readUsers(); // ensures seed
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      /* noop */
    }
    setHydrated(true);
  }, []);

  const persistSession = (u: User | null) => {
    if (typeof window === "undefined") return;
    if (u) window.localStorage.setItem(SESSION_KEY, JSON.stringify(u));
    else window.localStorage.removeItem(SESSION_KEY);
  };

  const value: AuthContextValue = {
    user,
    hydrated,
    login: (username, password) => {
      const users = readUsers();
      const match = users.find(
        (u) => u.username.toLowerCase() === username.toLowerCase() && u.password === password,
      );
      if (!match) return { ok: false, error: "Invalid username or password." };
      const pub: User = {
        id: match.id,
        username: match.username,
        fullName: match.fullName,
        email: match.email,
      };
      setUser(pub);
      persistSession(pub);
      return { ok: true };
    },
    register: ({ fullName, username, email, password }) => {
      if (!fullName || !username || !email || !password)
        return { ok: false, error: "All fields are required." };
      if (password.length < 6)
        return { ok: false, error: "Password must be at least 6 characters." };
      const users = readUsers();
      if (users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
        return { ok: false, error: "Username is already taken." };
      if (users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
        return { ok: false, error: "Email is already registered." };
      const newUser: StoredUser = {
        id: `u_${Date.now().toString(36)}`,
        username,
        fullName,
        email,
        password,
      };
      writeUsers([...users, newUser]);
      const pub: User = {
        id: newUser.id,
        username: newUser.username,
        fullName: newUser.fullName,
        email: newUser.email,
      };
      setUser(pub);
      persistSession(pub);
      return { ok: true };
    },
    logout: () => {
      setUser(null);
      persistSession(null);
    },
    resetRequest: (email) => {
      if (!email.includes("@")) return { ok: false, error: "Enter a valid email." };
      // Mock success regardless (to avoid user enumeration)
      return { ok: true };
    },
  };

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
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
