"use client";

import { useActionState } from "react";
import { confirmEnrollment, type EnrollState } from "./actions";

export function EnrollForm() {
  const [state, action, pending] = useActionState<EnrollState, FormData>(confirmEnrollment, {});
  return (
    <form className="stack" action={action}>
      <label>
        Código do app autenticador
        <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" required />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button disabled={pending}>{pending ? "Verificando…" : "Ativar TOTP"}</button>
    </form>
  );
}
