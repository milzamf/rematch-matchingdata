import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { usePreferences } from "@/lib/preferences";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in - BatchMatch" },
      { name: "description", content: "Sign in to your BatchMatch workspace." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { login, user, hydrated } = useAuth();
  const { t } = usePreferences();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (hydrated && user) navigate({ to: "/" });
  }, [hydrated, user, navigate]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username || !password) return setError(t("auth.loginMissing"));
    setLoading(true);
    setTimeout(() => {
      const res = login(username, password);
      setLoading(false);
      if (!res.ok) setError(authError(res.error, t));
      else navigate({ to: "/" });
    }, 350);
  };

  return (
    <AuthShell title={t("auth.signInTitle")} subtitle={t("auth.signInSubtitle")}>
      <form onSubmit={submit} className="space-y-4">
        <Field
          label={t("auth.username")}
          value={username}
          onChange={setUsername}
          placeholder={t("auth.usernamePlaceholder")}
          autoFocus
        />
        <Field
          label={t("auth.password")}
          type="password"
          value={password}
          onChange={setPassword}
          placeholder={t("auth.passwordPlaceholder")}
          rightSlot={
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-accent hover:underline"
            >
              {t("auth.forgot")}
            </Link>
          }
        />
        {error && (
          <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-brand text-brand-foreground py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          {t("auth.signIn")}
        </button>
      </form>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        {t("auth.noAccount")}{" "}
        <Link to="/register" className="font-medium text-accent hover:underline">
          {t("auth.createOne")}
        </Link>
      </p>
      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        {t("auth.demoAccount")} <span className="font-mono">demo</span> /{" "}
        <span className="font-mono">demo1234</span>
      </p>
    </AuthShell>
  );
}

export function authError(error: string, t: ReturnType<typeof usePreferences>["t"]) {
  const map: Record<string, Parameters<typeof t>[0]> = {
    "Invalid username or password.": "auth.error.invalid",
    "All fields are required.": "auth.error.required",
    "Password must be at least 6 characters.": "auth.error.passwordLength",
    "Username is already taken.": "auth.error.usernameTaken",
    "Email is already registered.": "auth.error.emailRegistered",
    "Enter a valid email.": "auth.error.emailInvalid",
  };
  return map[error] ? t(map[error]) : error;
}

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="size-9 bg-brand rounded-lg grid place-items-center">
            <div className="size-3.5 bg-brand-foreground rounded-[3px]" />
          </div>
          <span className="font-semibold text-lg tracking-tight">BatchMatch</span>
        </div>
        <div className="bg-card border border-border rounded-xl shadow-xs p-8">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground mb-6">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoFocus,
  rightSlot,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
  rightSlot?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {rightSlot}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  );
}
