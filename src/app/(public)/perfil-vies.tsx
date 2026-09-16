"use client";

import { useEffect, useState } from "react";
import {
  loadPerfil,
  savePerfil,
  summarize,
  type PerfilState,
} from "@/lib/perfil-local";

const SIDES = [
  { key: "esquerda", label: "Esquerda", color: "var(--vies-esquerda)" },
  { key: "centro", label: "Centro", color: "var(--vies-centro)" },
  { key: "direita", label: "Direita", color: "var(--vies-direita)" },
] as const;

/**
 * Meu Perfil de Viés — sidebar telemetry of the reader's own weekly
 * consumption (spec §2). 100% local: see lib/perfil-local.ts for the
 * privacy contract. Renders nothing until mounted (localStorage is
 * client-only; avoids a hydration mismatch).
 */
export function PerfilVies() {
  const [state, setState] = useState<PerfilState | null>(null);

  useEffect(() => {
    setState(loadPerfil());
  }, []);

  if (!state) return null;

  const update = (next: PerfilState) => {
    savePerfil(next);
    setState(next);
  };

  if (!state.on) {
    return (
      <section className="pc-side-section pc-perfil">
        <h3>Meu Perfil de Viés</h3>
        <p className="pc-side-note" style={{ margin: "0 0 0.7rem" }}>
          Acompanhe o equilíbrio da sua própria leitura semanal. Para preservar
          a sua privacidade, os dados ficam somente neste navegador.
        </p>
        <button
          className="pc-feedback-toggle"
          style={{ width: "100%" }}
          onClick={() => update({ on: true, events: state.events })}
        >
          Ativar perfil local
        </button>
      </section>
    );
  }

  const week = summarize(state.events, 7);

  return (
    <section className="pc-side-section pc-perfil">
      <h3>Meu Perfil de Viés</h3>
      {week.total === 0 ? (
        <p className="pc-side-note" style={{ margin: 0 }}>
          Sem leituras nos últimos 7 dias. Ao continuar para uma fonte a partir
          daqui, a faixa do artigo entra no seu balanço.
        </p>
      ) : (
        <>
          <p className="pc-card-meta" style={{ margin: "0 0 0.4rem" }}>
            sua exposição política semanal · {week.total} leitura
            {week.total === 1 ? "" : "s"}
          </p>
          <div style={{ display: "flex", gap: 2, height: 10 }}>
            {SIDES.map((s) => {
              const n = week[s.key];
              if (n === 0) return null;
              return (
                <div
                  key={s.key}
                  title={`${s.label}: ${n} leitura${n === 1 ? "" : "s"}`}
                  style={{
                    width: `${(n / week.total) * 100}%`,
                    background: s.color,
                    minWidth: 3,
                  }}
                />
              );
            })}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 5,
              fontSize: "var(--fs-data)",
              textTransform: "uppercase",
              letterSpacing: "var(--track-caps)",
            }}
          >
            {SIDES.map((s) => (
              <span key={s.key} style={{ color: week[s.key] > 0 ? s.color : "var(--text-faint)" }}>
                {Math.round((week[s.key] / week.total) * 100)}% {s.label.toLowerCase()}
              </span>
            ))}
          </div>
        </>
      )}
      <p className="pc-card-meta" style={{ margin: "0.7rem 0 0.5rem" }}>
        Dados somente neste navegador.
      </p>
      <button
        className="pc-feedback-toggle"
        style={{ width: "100%" }}
        onClick={() => update({ on: false, events: [] })}
      >
        Apagar dados e desativar
      </button>
    </section>
  );
}
