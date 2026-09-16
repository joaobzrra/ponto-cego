import { redirect } from "next/navigation";
import { getSessionAdmin } from "@/lib/auth";
import "../admin.css";
import { LoginForm } from "./login-form";

export const metadata = { title: "Ponto Cego — Admin" };

export default async function LoginPage() {
  if (await getSessionAdmin()) redirect("/admin");
  return (
    <div className="card auth-card">
      <h1 style={{ fontWeight: 300, letterSpacing: "0.2em", fontSize: "1.1rem" }}>
        PONTO CEGO · ADMIN
      </h1>
      <LoginForm />
    </div>
  );
}
