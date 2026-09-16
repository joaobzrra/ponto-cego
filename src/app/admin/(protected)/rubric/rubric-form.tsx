"use client";

import { useActionState } from "react";
import type { RubricFormState } from "./actions";
import { publishRubric } from "./actions";

export function RubricForm({ currentContent }: { currentContent: string }) {
  const [state, formAction, pending] = useActionState<RubricFormState, FormData>(
    publishRubric,
    {},
  );
  return (
    <form className="stack" action={formAction}>
      <label>
        Conteúdo da rubrica (system prompt do classificador)
        <textarea
          name="content"
          rows={24}
          defaultValue={currentContent}
          className="mono"
          style={{ fontSize: "0.8rem", lineHeight: 1.5 }}
          required
        />
      </label>
      <label>
        Nota de mudança (obrigatória — vira o change log da versão)
        <input name="changeNote" required placeholder="ex.: endurece o portão NC para economia de serviço" />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="muted">{state.ok}</p>}
      <button disabled={pending}>
        {pending ? "Publicando…" : "Publicar nova versão (ativa imediatamente)"}
      </button>
    </form>
  );
}
