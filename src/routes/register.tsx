import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Masuk - RE-MATCH" },
      { name: "description", content: "Halaman registrasi tidak tersedia" },
    ],
  }),
  component: RegisterRedirect,
});

function RegisterRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate({ to: "/login", replace: true });
  }, [navigate]);

  return null;
}
