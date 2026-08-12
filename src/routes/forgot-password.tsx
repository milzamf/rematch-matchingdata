import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Masuk - RE-MATCH" },
      { name: "description", content: "Halaman reset kata sandi tidak tersedia" },
    ],
  }),
  component: ForgotPasswordRedirect,
});

function ForgotPasswordRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate({ to: "/login", replace: true });
  }, [navigate]);

  return null;
}
