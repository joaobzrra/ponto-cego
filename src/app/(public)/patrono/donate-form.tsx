"use client";

import { useState, useTransition } from "react";
import { PRESET_CENTS } from "@/lib/patrono";
import { startDonation } from "./actions";

function formatReais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function DonateForm() {
  const [selected, setSelected] = useState<number | "custom">(PRESET_CENTS[0]);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = selected === "custom" ? custom : selected;
    startTransition(async () => {
      const result = await startDonation(value);
      if (result.status === "ok") {
        window.location.assign(result.url);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="pc-donate-form">
      <div className="pc-donate-presets">
        {PRESET_CENTS.map((cents) => (
          <button
            key={cents}
            type="button"
            className={`pc-btn pc-btn--ghost${selected === cents ? " is-selected" : ""}`}
            onClick={() => setSelected(cents)}
            disabled={pending}
          >
            {formatReais(cents)}
          </button>
        ))}
        <input
          type="text"
          inputMode="decimal"
          placeholder="R$"
          value={custom}
          onFocus={() => setSelected("custom")}
          onChange={(e) => {
            setSelected("custom");
            setCustom(e.target.value);
          }}
          disabled={pending}
          className={`pc-donate-custom${selected === "custom" ? " is-selected" : ""}`}
          aria-label="Outro valor"
        />
      </div>

      <button type="submit" className="pc-btn pc-btn--solid" disabled={pending}>
        {pending ? "Abrindo…" : "Doar via Mercado Pago"}
      </button>

      <p className="pc-donate-note">Sem cadastro. Não guardamos nada sobre você.</p>

      {error && (
        <p className="pc-donate-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
