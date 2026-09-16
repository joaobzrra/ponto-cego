"use client";

import { useActionState, useState } from "react";
import type { Band } from "@/db/schema";
import { submitFeedback, type FeedbackState } from "./actions";

/**
 * Concordo/Discordo controls (spec §9). Discordo reveals an interactive
 * version of the bias meter — same 7-slot geometry and data colors as the
 * read-only BiasBar (per side: 33% / 66% / 100% from center) — and the
 * reader's pick is recorded as their suggested band. NC is not offered.
 */
const SLOTS: Array<{ band: Exclude<Band, "NC">; name: string; color: string }> = [
  { band: "E3", name: "Esquerda forte", color: "var(--vies-esquerda)" },
  { band: "E2", name: "Esquerda moderada", color: "var(--vies-esquerda)" },
  { band: "E1", name: "Esquerda leve", color: "var(--vies-esquerda)" },
  { band: "C", name: "Centro", color: "var(--vies-centro)" },
  { band: "D1", name: "Direita leve", color: "var(--vies-direita)" },
  { band: "D2", name: "Direita moderada", color: "var(--vies-direita)" },
  { band: "D3", name: "Direita forte", color: "var(--vies-direita)" },
];

export function FeedbackControls({ articleId }: { articleId: number }) {
  const [suggesting, setSuggesting] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [state, feedbackAction, pending] = useActionState<FeedbackState, FormData>(
    submitFeedback,
    { status: "idle" },
  );

  if (state.status === "recorded" || state.status === "already-recorded") {
    return (
      <p className="pc-card-meta" style={{ marginTop: "0.75rem" }} role="status">
        Obrigado — seu voto foi registrado e entrou na revisão humana.
      </p>
    );
  }

  return (
    <>
      <p className="pc-card-meta" style={{ marginTop: "0.75rem" }}>
        O rótulo está correto? Sua resposta vai para revisão humana — nunca ajusta o
        rótulo automaticamente.
      </p>

      {state.status === "rate-limited" && !suggesting && (
        <p className="pc-card-meta" role="alert">
          Limite temporário de votos atingido. Tente novamente em uma hora.
        </p>
      )}
      {state.status === "invalid" && !suggesting && (
        <p className="pc-card-meta" role="alert">
          Não foi possível registrar este voto. Recarregue a página e tente novamente.
        </p>
      )}

      {!suggesting ? (
        <div className="pc-feedback">
          <form action={feedbackAction} style={{ flex: 1, display: "flex" }}>
            <input type="hidden" name="articleId" value={articleId} />
            <input type="hidden" name="direction" value="agree" />
            <button style={{ flex: 1 }} disabled={pending}>
              {pending ? "Registrando…" : "Concordo"}
            </button>
          </form>
          <button
            style={{ flex: 1 }}
            className="pc-feedback-toggle"
            onClick={() => setSuggesting(true)}
            disabled={pending}
          >
            Discordo
          </button>
        </div>
      ) : (
        <form action={feedbackAction}>
          <input type="hidden" name="articleId" value={articleId} />
          <input type="hidden" name="direction" value="disagree" />
          <p className="pc-card-meta" style={{ marginTop: "0.6rem" }}>
            Como você classificaria? Toque na posição:
            <span style={{ minHeight: "1em", display: "block", color: "var(--text)" }}>
              {hovered ?? " "}
            </span>
          </p>
          <div className="pc-meter" role="group" aria-label="Sugerir classificação">
            <div className="pc-meter-track" />
            <div className="pc-meter-center" />
            {SLOTS.map((s, i) => (
              <button
                key={s.band}
                type="submit"
                disabled={pending}
                name="suggestedBand"
                value={s.band}
                title={`${s.name} (${s.band})`}
                aria-label={`${s.name} (${s.band})`}
                className="pc-meter-slot"
                style={{
                  left: `calc(${(i / (SLOTS.length - 1)) * 100}% - 9px)`,
                  ["--slot-color" as string]: s.color,
                }}
                onMouseEnter={() => setHovered(`${s.name} (${s.band})`)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(`${s.name} (${s.band})`)}
                onBlur={() => setHovered(null)}
              />
            ))}
          </div>
          <div
            className="pc-card-meta"
            style={{ display: "flex", justifyContent: "space-between", marginTop: "0.2rem" }}
          >
            <span>E3</span>
            <span>C</span>
            <span>D3</span>
          </div>
          <button
            type="button"
            className="pc-feedback-toggle"
            style={{ width: "100%", marginTop: "0.6rem" }}
            onClick={() => setSuggesting(false)}
            disabled={pending}
          >
            voltar
          </button>
          {state.status === "rate-limited" && (
            <p className="pc-card-meta" role="alert">
              Limite temporário de votos atingido. Tente novamente em uma hora.
            </p>
          )}
          {state.status === "invalid" && (
            <p className="pc-card-meta" role="alert">
              Não foi possível registrar este voto. Recarregue a página e tente novamente.
            </p>
          )}
        </form>
      )}
    </>
  );
}
