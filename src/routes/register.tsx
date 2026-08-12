import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { usePreferences } from "@/lib/preferences";
import { AuthShell, Field, authError } from "./login";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Buat akun - RE-MATCH" },
      { name: "description", content: "Buat akses RE-MATCH" },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const { register, user, hydrated } = useAuth();
  const { t } = usePreferences();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (hydrated && user) navigate({ to: "/" });
  }, [hydrated, user, navigate]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setTimeout(() => {
      const res = register({ fullName, username, email, password });
      setLoading(false);
      if (!res.ok) setError(authError(res.error, t));
      else navigate({ to: "/" });
    }, 350);
  };

  return (
    <AuthShell title={t("auth.createTitle")} subtitle={t("auth.createSubtitle")}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t("auth.fullName")} value={fullName} onChange={setFullName} placeholder={t("auth.fullNamePlaceholder")} autoFocus />
        <Field label={t("auth.username")} value={username} onChange={setUsername} placeholder={t("auth.usernamePlaceholder")} />
        <Field label={t("auth.email")} type="email" value={email} onChange={setEmail} placeholder="nama@bps.go.id" />
        <Field label={t("auth.password")} type="password" value={password} onChange={setPassword} placeholder={t("auth.passwordMin")} />
        {error && (
          <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-brand text-brand-foreground py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          {t("auth.createAccount")}
        </button>
      </form>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        {t("auth.haveAccount")}{" "}
        <Link to="/login" className="font-medium text-accent hover:underline">
          {t("auth.signIn")}
        </Link>
      </p>
    </AuthShell>
  );
}
