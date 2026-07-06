import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { usePreferences } from "@/lib/preferences";
import { AuthShell, Field, authError } from "./login";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password — BatchMatch" },
      { name: "description", content: "Reset your BatchMatch password." },
    ],
  }),
  component: ForgotPage,
});

function ForgotPage() {
  const { resetRequest } = useAuth();
  const { t } = usePreferences();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setTimeout(() => {
      const res = resetRequest(email);
      setLoading(false);
      if (!res.ok) setError(authError(res.error, t));
      else setSent(true);
    }, 350);
  };

  return (
    <AuthShell
      title={t("auth.resetTitle")}
      subtitle={t("auth.resetSubtitle")}
    >
      {sent ? (
        <div className="text-center py-4">
          <div className="size-12 rounded-full bg-success/10 grid place-items-center mx-auto mb-3">
            <CheckCircle2 className="size-6 text-success" />
          </div>
          <p className="text-sm font-semibold">{t("auth.checkInbox")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("auth.resetSent", { email })}
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block text-xs font-medium text-accent hover:underline"
          >
            {t("auth.backToSignIn")}
          </Link>
        </div>
      ) : (
        <>
          <form onSubmit={submit} className="space-y-4">
            <Field label={t("auth.email")} type="email" value={email} onChange={setEmail} placeholder="you@company.com" autoFocus />
            {error && (
              <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-brand text-brand-foreground py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              {t("auth.sendReset")}
            </button>
          </form>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            {t("auth.remembered")}{" "}
            <Link to="/login" className="font-medium text-accent hover:underline">
              {t("auth.signIn")}
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
