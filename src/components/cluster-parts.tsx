import Link from "next/link";
import {
  BAND_LABEL,
  BAND_TONE,
  DivergingBar,
  OUTLET_SIDE_LABEL,
  SMALL_SAMPLE,
  outletSide,
} from "@/components/bias";
import { WarningBadge } from "@/components/warning-badge";
import { relTime } from "@/components/article-card";
import type { Band } from "@/db/schema";
import type { OutletAggregate } from "@/lib/classification";

/*
 * Shared pieces of the cluster surfaces (/topicos cards and the /e/[id]
 * thread page): the side mapping, the per-side distinct-outlet counts the
 * ClusterMeter consumes, and the member row (side dot · outlet · title · age).
 */

export type Member = {
  id: number;
  title: string;
  band: Band | null;
  at: Date;
  outletName: string;
  outletSlug: string;
  /** Needed only where the card expands to the outlet's 90-day bar (thread page). */
  outletId?: number;
  outletWarning: string | null;
  /** Ownership transparency chip (thread page) — shown only when verified. */
  owner?: string | null;
  ownerType?: string | null;
  ownerVerified?: boolean;
  /** Public source for the ownership fact — the rule is "verified, always with source". */
  ownerSourceUrl?: string | null;
};

export type Side = "esquerda" | "centro" | "direita";

export function sideOf(band: Band | null): Side | null {
  if (!band || band === "NC") return null;
  if (band.startsWith("E")) return "esquerda";
  if (band.startsWith("D")) return "direita";
  return "centro";
}

/** Distinct outlets per side — the ClusterMeter's blindspot math. */
export function sideCounts(members: Member[]): Record<Side, number> {
  const seen: Record<Side, Set<string>> = {
    esquerda: new Set(),
    centro: new Set(),
    direita: new Set(),
  };
  for (const m of members) {
    const side = sideOf(m.band);
    if (side) seen[side].add(m.outletSlug);
  }
  return {
    esquerda: seen.esquerda.size,
    centro: seen.centro.size,
    direita: seen.direita.size,
  };
}

/**
 * Source card (thread page, user decision 2026-07-16):
 * tinted header strip carrying the outlet identity on the left and the
 * transparency chips on the right (ownership category when admin-verified,
 * band label in the side's color), then the headline and age below. Our
 * factuality equivalent is ownership transparency — we never rate truth.
 */
export function SourceCard({ m, agg }: { m: Member; agg?: OutletAggregate }) {
  const side = sideOf(m.band);
  // The aggregate is a 90-day window and the thread is not: an old article's
  // band may have no segment to sit on, so the dot is only drawn when it does.
  const inWindow = !!agg && !!m.band && m.band !== "NC" && (agg.bandCounts[m.band] ?? 0) > 0;
  const head = (
    <>
      <span className="pc-src-outlet">
        <span
          className="dot"
          title={m.band ? BAND_LABEL[m.band] : "sem classificação"}
          style={{ background: side ? `var(--vies-${side})` : "var(--border)" }}
        />
        {m.outletName} <WarningBadge label={m.outletWarning} />
      </span>
      <span className="pc-src-chips">
        {m.ownerVerified && m.ownerType && (
          <span className="pc-src-chip" title={m.owner ? `Dono: ${m.owner}` : undefined}>
            {m.ownerType}
          </span>
        )}
        {m.band && m.band !== "NC" && side && (
          <span
            className="pc-src-chip band"
            style={{ color: BAND_TONE[m.band] }}
            title={`Viés deste artigo: ${BAND_LABEL[m.band]}`}
          >
            {BAND_LABEL[m.band]}
          </span>
        )}
      </span>
    </>
  );
  return (
    <article className="pc-src-card">
      {agg ? (
        /*
         * Owner decision 2026-09-04: the outlet strip expands, like a Veículos
         * row, to the outlet's 90-day diverging bar with THIS article's band
         * marked on it — "where does this piece sit in what this outlet
         * usually publishes". Native <details>, no script.
         */
        <details className="pc-src-x">
          <summary className="pc-src-head">{head}</summary>
          <div className="pc-src-body">
            <div className="pc-src-body-head">Viés do veículo e artigo</div>
            <DivergingBar
              counts={agg.bandCounts}
              politicalArticles={agg.politicalArticles}
              mark={inWindow ? m.band : null}
              tooltip={`Artigo: ${
                m.band && m.band !== "NC" ? BAND_LABEL[m.band] : "não é política"
              } | Veículo: ${OUTLET_SIDE_LABEL[outletSide(agg.bandCounts, agg.politicalArticles)]}`}
            />
            <div className="pc-src-body-meta">
              {agg.politicalArticles} artigo{agg.politicalArticles === 1 ? "" : "s"} político
              {agg.politicalArticles === 1 ? "" : "s"} em 90 d
              {agg.politicalArticles > 0 && agg.politicalArticles < SMALL_SAMPLE && " · amostra pequena"}
              {m.band && m.band !== "NC" && !inWindow && " · este artigo está fora da janela"}
            </div>
            {m.ownerVerified && m.owner && (
              <div className="pc-src-body-owner">
                {m.ownerType && <>{m.ownerType} · </>}
                {m.owner}
                {m.ownerSourceUrl && (
                  <>
                    {" "}
                    <a href={m.ownerSourceUrl} target="_blank" rel="noopener">
                      fonte ↗
                    </a>
                  </>
                )}
              </div>
            )}
            <Link href="/veiculos" className="pc-src-body-link">
              todos os veículos →
            </Link>
          </div>
        </details>
      ) : (
        <div className="pc-src-head">{head}</div>
      )}
      <Link href={`/a/${m.id}`} className="pc-src-link">
        <h3 className="pc-src-title">{m.title}</h3>
      </Link>
      <div className="pc-src-meta">{relTime(m.at)}</div>
    </article>
  );
}

export function MemberRow({ m }: { m: Member }) {
  const side = sideOf(m.band);
  return (
    <Link href={`/a/${m.id}`} className="pc-cluster-src">
      <span
        className="dot"
        title={m.band ? BAND_LABEL[m.band] : "sem classificação"}
        style={{ background: side ? `var(--vies-${side})` : "var(--border)" }}
      />
      <span className="outlet">
        {m.outletName} <WarningBadge label={m.outletWarning} />
      </span>
      <span className="pc-cluster-src-title">{m.title}</span>
      <span className="when">{relTime(m.at)}</span>
    </Link>
  );
}
