"use client";

import { useActionState } from "react";
import {
  resetPassword,
  resetTotp,
  toggleDisabled,
  updateRole,
  type UserActionState,
} from "./actions";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "moderator", label: "Moderador" },
  { value: "patron", label: "Patrono" },
] as const;

/**
 * Per-user controls. `self` disables the lockout-prone actions client-side;
 * the server actions enforce the same rules regardless.
 */
export function UserRowActions({
  id,
  role,
  disabled,
  self,
}: {
  id: number;
  role: string;
  disabled: boolean;
  self: boolean;
}) {
  const [pwState, pwAction, pwPending] = useActionState<UserActionState, FormData>(
    resetPassword,
    {},
  );
  return (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
      <form action={updateRole} style={{ display: "flex", gap: "0.35rem" }}>
        <input type="hidden" name="id" value={id} />
        <select name="role" defaultValue={role} disabled={self} title={self ? "Você não pode alterar o próprio papel" : undefined}>
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {!self && (
          <button className="ghost" type="submit">
            Salvar papel
          </button>
        )}
      </form>
      <form action={toggleDisabled}>
        <input type="hidden" name="id" value={id} />
        <button className={disabled ? "ghost" : "danger"} type="submit" disabled={self} title={self ? "Você não pode desativar a si mesmo" : undefined}>
          {disabled ? "Reativar" : "Desativar"}
        </button>
      </form>
      <form action={resetTotp}>
        <input type="hidden" name="id" value={id} />
        <button className="ghost" type="submit">
          Resetar TOTP
        </button>
      </form>
      <form action={pwAction}>
        <input type="hidden" name="id" value={id} />
        <button className="ghost" type="submit" disabled={pwPending}>
          {pwPending ? "Gerando…" : "Resetar senha"}
        </button>
      </form>
      {pwState.error && <span className="error">{pwState.error}</span>}
      {pwState.tempPassword && (
        <span>
          Nova senha temporária:{" "}
          <code style={{ userSelect: "all" }}>{pwState.tempPassword}</code>
        </span>
      )}
    </div>
  );
}
