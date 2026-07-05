import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { AuthShell, Field } from "./login";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create account — BatchMatch" },
      { name: "description", content: "Create a BatchMatch workspace." },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const { register, user, hydrated } = useAuth();
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
      if (!res.ok) setError(res.error);
      else navigate({ to: "/" });
    }, 350);
  };

  return (
    <AuthShell title="Create your workspace" subtitle="Every account gets its own private workspace">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name" value={fullName} onChange={setFullName} placeholder="Andi Setiawan" autoFocus />
        <Field label="Username" value={username} onChange={setUsername} placeholder="andi" />
        <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@company.com" />
        <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="At least 6 characters" />
        {error && (
          <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-brand text-brand-foreground py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          Create account
        </button>
      </form>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
