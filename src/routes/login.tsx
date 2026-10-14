import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { defaultRouteForRole } from "@/lib/authorization";
import { usePreferences } from "@/lib/preferences";
import { LogoIcon } from "@/components/ui/logo";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Masuk - RE-MATCH" }, { name: "description", content: "Masuk ke RE-MATCH" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { currentUser, isAuthenticated, isLoadingAuth, login } = useAuth();
  const { t } = usePreferences();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isLoadingAuth && isAuthenticated) {
      navigate({ to: defaultRouteForRole(currentUser?.role ?? null), replace: true });
    }
  }, [currentUser?.role, isAuthenticated, isLoadingAuth, navigate]);

  const submit = async (event?: React.FormEvent) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (loading || isLoadingAuth) return;

    setError(null);

    if (!email || !password) {
      setError(t("auth.loginMissing"));
      return;
    }

    setLoading(true);
    const result = await login({ email, password });
    setLoading(false);

    if (!result.ok) {
      setError(authError(result.error, t));
      return;
    }
  };

  return (
    <AuthShell title={t("auth.signInTitle")} subtitle={t("auth.signInSubtitle")}>
      <form onSubmit={submit} action="#" method="post" noValidate className="space-y-4">
        <Field
          label={t("auth.usernameOrEmail")}
          type="text"
          value={email}
          onChange={setEmail}
          placeholder={t("auth.loginIdentifierPlaceholder") || "Masukkan Email/Username"}
          autoFocus
          autoComplete="username"
          inputMode="text"
          disabled={isLoadingAuth || loading}
        />
        <Field
          label={t("auth.password")}
          type="password"
          value={password}
          onChange={setPassword}
          placeholder={t("auth.passwordPlaceholder")}
          autoComplete="current-password"
          disabled={isLoadingAuth || loading}
        />
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || isLoadingAuth}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-brand-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          {t("auth.signIn")}
        </button>
      </form>

      {currentUser && (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          {t("auth.loggedInAs")} {currentUser.name}
        </p>
      )}
    </AuthShell>
  );
}

export function authError(error: string, t: ReturnType<typeof usePreferences>["t"]) {
  const map: Record<string, Parameters<typeof t>[0]> = {
    "Email or password is incorrect": "auth.error.invalid",
    "Unable to connect to the server": "auth.error.server",
    "All fields are required": "auth.error.required",
    "All fields are required.": "auth.error.required",
  };

  return map[error] ? t(map[error]) : error;
}

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  const { t } = usePreferences();

  const formattedSubtitle =
    typeof subtitle === "string" && subtitle.includes("RE-MATCH") ? (
      <>
        {subtitle.split("RE-MATCH")[0]}
        <span className="inline-block whitespace-nowrap font-medium text-foreground">
          RE&#8209;MATCH
        </span>
        {subtitle.split("RE-MATCH")[1]}
      </>
    ) : (
      subtitle
    );

  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:py-12 flex items-center justify-center">
      <div className="w-full max-w-md sm:max-w-lg">
        <div className="mb-6 sm:mb-8 flex flex-col items-center gap-3 text-center">
          <LogoIcon className="w-14 h-14 sm:w-16 sm:h-16" />
          <div className="w-full flex flex-col items-center">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground select-none">
              <span className="inline-block whitespace-nowrap">
                RE&#8209;<span className="text-brand">MATCH</span>
              </span>
            </h1>
            <p className="mt-1 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-brand">
              {t("brand.subtitle")}
            </p>
            <p className="mt-1 text-[10px] min-[360px]:text-[11px] sm:text-xs md:text-[13px] font-medium text-muted-foreground tracking-tight whitespace-nowrap select-none max-w-full text-center">
              {t("brand.organizationUnit")}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 sm:p-8 shadow-xs">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <div className="mt-1 mb-5 sm:mb-6 text-xs sm:text-sm text-muted-foreground leading-normal">
            {formattedSubtitle}
          </div>
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
  autoComplete,
  inputMode,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "none" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        inputMode={inputMode}
        disabled={disabled}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  );
}
