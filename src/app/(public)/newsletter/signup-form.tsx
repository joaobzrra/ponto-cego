"use client";

import { useActionState } from "react";
import { subscribe, type SubscribeResult } from "./actions";

const initial: SubscribeResult = { status: "ok", message: "" };

export function SignupForm({ source, compact = false }: { source: "newsletter-page" | "home-box"; compact?: boolean }) {
  const [state, action, pending] = useActionState(async (_: SubscribeResult, fd: FormData) => subscribe(fd), initial);
  return (
    <form action={action} className={compact ? "pc-nl-form pc-nl-form--compact" : "pc-nl-form"}>
      <input type="hidden" name="source" value={source} />
      <label className="pc-nl-label" htmlFor={`nl-${source}`}>Seu e-mail</label>
      <div className="pc-nl-row">
        <input id={`nl-${source}`} name="email" type="email" required autoComplete="email" placeholder="voce@exemplo.com" className="pc-nl-input" />
        <button type="submit" className="pc-btn" disabled={pending}>{pending ? "Enviando…" : "Assinar"}</button>
      </div>
      <p className={state.status === "error" ? "pc-nl-msg pc-nl-msg--err" : "pc-nl-msg"} role="status">{state.message}</p>
      {!compact && <p className="pc-nl-fine">Todo dia às 7h. Um clique para sair. <a href="/privacidade#newsletter">Privacidade</a>.</p>}
    </form>
  );
}
