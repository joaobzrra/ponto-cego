"use client";

import { useActionState } from "react";
import { createUser, type UserActionState } from "./actions";

/** Labels duplicated from lib/roles (that module is server-only). */
const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "moderator", label: "Moderador" },
  { value: "patron", label: "Patrono" },
] as const;

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState<UserActionState, FormData>(createUser, {});
  return (
    <div>
      <form action={formAction} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ flex: "2 1 240px" }}>
          E-mail
          <input name="email" type="email" placeholder="pessoa@exemplo.com" required />
        </label>
        <label style={{ flex: "0 1 160px" }}>
          Papel
          <select name="role" defaultValue="patron">
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Criando…" : "Criar usuário"}
        </button>
      </form>
      {state.error && <p className="error">{state.error}</p>}
      {state.tempPassword && (
        <p style={{ marginTop: "0.75rem" }}>
          Usuário <strong>{state.email}</strong> criado. Senha temporária (mostrada só agora,
          copie e envie por canal seguro):{" "}
          <code style={{ userSelect: "all", fontSize: "1rem" }}>{state.tempPassword}</code>
          <br />
          <span className="muted">No primeiro login será exigida a ativação de TOTP (QR code).</span>
        </p>
      )}
    </div>
  );
}
