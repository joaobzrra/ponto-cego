"use client";

import { useActionState } from "react";
import type { FeedInput, OutletFormState } from "./actions";

type OutletValues = {
  id?: number;
  name?: string;
  slug?: string;
  feeds?: FeedInput[];
  fetchIntervalMinutes?: number;
  complianceStatus?: string;
  complianceNotes?: string | null;
  owner?: string | null;
  ownerType?: string | null;
  ownerSourceUrl?: string | null;
  ownerVerified?: boolean;
  warningLabel?: string | null;
  fetchUserAgent?: string | null;
  reachWeight?: number | null;
  reachSource?: string | null;
  reachRank?: number | null;
  reachUpdatedAt?: Date | null;
};

function fmtDdmm(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function feedLines(feeds?: FeedInput[]): string {
  return (feeds ?? [])
    .map((f) => [f.url, f.scope, ...(f.enabled ? [] : ["off"])].join(" "))
    .join("\n");
}

export function OutletForm({
  action,
  values = {},
  submitLabel,
}: {
  action: (prev: OutletFormState, formData: FormData) => Promise<OutletFormState>;
  values?: OutletValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<OutletFormState, FormData>(action, {});
  return (
    <form className="stack" action={formAction}>
      {values.id != null && <input type="hidden" name="id" value={values.id} />}
      <label>
        Nome
        <input name="name" defaultValue={values.name} required />
      </label>
      <label>
        Slug
        <input name="slug" defaultValue={values.slug} required pattern="[a-z0-9-]+" />
      </label>
      <label>
        Feeds (um por linha: URL [politica|geral] [off])
        <textarea
          name="feeds"
          rows={4}
          defaultValue={feedLines(values.feeds)}
          placeholder={"https://exemplo.com/politica/rss politica\nhttps://exemplo.com/rss geral off"}
          required
        />
      </label>
      <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
        Prefira o feed de seção política quando o veículo tiver um (Addendum 01). Feeds
        removidos da lista são desativados, nunca apagados — o histórico de coletas os
        referencia.
      </p>
      <label>
        Intervalo de coleta (minutos)
        <input
          name="fetchIntervalMinutes"
          type="number"
          min={5}
          defaultValue={values.fetchIntervalMinutes ?? 10}
        />
      </label>
      <label>
        Compliance (robots.txt / termos — spec §3.3)
        <select name="complianceStatus" defaultValue={values.complianceStatus ?? "pending"}>
          <option value="pending">pendente</option>
          <option value="approved">aprovado</option>
          <option value="restricted">restrito</option>
        </select>
      </label>
      <label>
        Notas de compliance
        <textarea name="complianceNotes" rows={2} defaultValue={values.complianceNotes ?? ""} />
      </label>
      <label>
        Dono (transparência de propriedade — fato registral, sem adjetivos)
        <input
          name="owner"
          defaultValue={values.owner ?? ""}
          placeholder="ex.: Grupo Globo (família Marinho)"
        />
      </label>
      <label>
        Tipo de controle
        <select name="ownerType" defaultValue={values.ownerType ?? ""}>
          <option value="">—</option>
          <option value="familiar">familiar</option>
          <option value="corporativo">corporativo</option>
          <option value="estatal">estatal</option>
          <option value="individual">individual</option>
          <option value="independente">independente (sem dono único / sem fins lucrativos)</option>
          <option value="sindical">sindical (centrais/movimentos de trabalhadores)</option>
          <option value="partidário">partidário (vínculo declarado com partido)</option>
        </select>
      </label>
      <label>
        Fonte pública da informação (URL)
        <input name="ownerSourceUrl" defaultValue={values.ownerSourceUrl ?? ""} />
      </label>
      <label style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          name="ownerVerified"
          defaultChecked={values.ownerVerified ?? false}
          style={{ width: "auto" }}
        />
        Verificado — só então aparece no site público
      </label>
      <label>
        Rótulo de alerta público (badge vermelho junto ao nome — só fatos de
        procedência, ex.: Estatal Russa; vazio = sem badge)
        <input name="warningLabel" defaultValue={values.warningLabel ?? ""} />
      </label>
      <label>
        User-Agent de coleta (override — apenas quando o robots.txt permite
        crawling mas o WAF bloqueia o UA identificado do bot; vazio = UA padrão)
        <input name="fetchUserAgent" defaultValue={values.fetchUserAgent ?? ""} />
      </label>
      <label>
        Peso de alcance (override manual)
        {/* Prefill ONLY a manual override — echoing the auto value here would
            re-submit it on any routine edit and silently flip the outlet to
            "manual", killing the automation. Auto values live in the
            placeholder + provenance line instead. */}
        <input
          name="reachWeight"
          inputMode="decimal"
          defaultValue={values.reachSource === "manual" ? (values.reachWeight ?? "") : ""}
          placeholder={
            values.reachSource && values.reachSource !== "manual"
              ? `auto: ${values.reachWeight} (${values.reachSource})`
              : "ex.: 120"
          }
        />
      </label>
      <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
        O peso é derivado automaticamente de dados públicos de tráfego (Google
        CrUX / Tranco) uma vez por mês. Preencher este campo sobrepõe o valor
        automático e marca o veículo como &quot;manual&quot;; deixá-lo vazio
        devolve o veículo ao cálculo automático na próxima rodada de
        atualização.
      </p>
      <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
        {values.reachSource
          ? `Atual: ${values.reachWeight ?? "—"} · fonte ${values.reachSource} · rank ${
              values.reachRank ?? "—"
            } · atualizado ${
              values.reachUpdatedAt ? fmtDdmm(new Date(values.reachUpdatedAt)) : "—"
            }`
          : "Ainda não calculado — rode scripts/update-reach.ts"}
      </p>
      {state.error && <p className="error">{state.error}</p>}
      <button disabled={pending}>{pending ? "Salvando…" : submitLabel}</button>
    </form>
  );
}
