"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form className="stack" action={action}>
      <label>
        E-mail
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Senha
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <label>
        Código TOTP <span className="muted">(vazio no primeiro acesso)</span>
        <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}
