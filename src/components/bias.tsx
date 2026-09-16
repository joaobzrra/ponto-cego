/**
 * The bias visuals (spec §2) — built in the admin first so the visual language
 * is tested on real data before the public site (stage 6) reuses it as-is.
 *
 * Rules baked in:
 * - Color is data, never decoration: esquerda=crimson, centro=slate (neutral
 *   gray midpoint, deliberately low-chroma), direita=blue. Palette validated
 *   for contrast/CVD on the dark canvas.
 * - The article bar renders the BAND as a discrete slider position — never a
 *   raw model number; no "-78"-style false precision (spec §2 v2 change).
 * - NC renders no bar at all: not politics ≠ center.
 * - Identity is never color-alone: every element carries a text label/tooltip.
 */
import type { Band } from "@/db/schema";

export const BAND_LABEL: Record<Band, string> = {
  E3: "Esquerda forte",
  E2: "Esquerda moderada",
  E1: "Esquerda leve",
  C: "Centro",
  D1: "Direita leve",
  D2: "Direita moderada",
  D3: "Direita forte",
  NC: "Não classificável (não é política)",
};

const BAND_ORDER: Exclude<Band, "NC">[] = ["E3", "E2", "E1", "C", "D1", "D2", "D3"];

/** Band → intensity tone (globals.css): forte = the side color, moderada and
 * leve = progressively lighter tints of the same hue. Chips/labels use this;
 * side-level visuals (bars, dots) keep the plain side colors. */
export const BAND_TONE: Record<Exclude<Band, "NC">, string> = {
  E3: "var(--vies-esquerda)",
  E2: "var(--vies-esquerda-2)",
  E1: "var(--vies-esquerda-1)",
  C: "var(--vies-centro)",
  D1: "var(--vies-direita-1)",
  D2: "var(--vies-direita-2)",
  D3: "var(--vies-direita)",
};

function bandColor(band: Exclude<Band, "NC">): string {
  if (band.startsWith("E")) return "var(--vies-esquerda)";
  if (band.startsWith("D")) return "var(--vies-direita)";
  return "var(--vies-centro)";
}

/**
 * Article-level bias bar: a track with a marker at one of 7 discrete slots.
 * This is the element article cards will carry on the public site.
 */
export function BiasBar({ band }: { band: Band | null }) {
  if (!band) return null;
  if (band === "NC") {
    return (
      <span className="muted" style={{ fontSize: "var(--fs-data)" }} title={BAND_LABEL.NC}>
        sem viés — não é política
      </span>
    );
  }
  const idx = BAND_ORDER.indexOf(band);
  const pct = (idx / (BAND_ORDER.length - 1)) * 100;
  const label = `Viés: ${BAND_LABEL[band]} (${band})`;
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      style={{ position: "relative", width: 120, height: 12, margin: "0.3rem 0" }}
    >
      {/* track */}
      <div
        style={{
          position: "absolute",
          top: 5,
          left: 0,
          right: 0,
          height: 2,
          background: "var(--border)",
          borderRadius: 1,
        }}
      />
      {/* center tick */}
      <div
        style={{
          position: "absolute",
          top: 2,
          left: "50%",
          width: 1,
          height: 8,
          background: "var(--text-faint)",
        }}
      />
      {/* band marker — ≥8px, ringed against the surface */}
      <div
        style={{
          position: "absolute",
          top: 1,
          left: `calc(${pct}% - 5px)`,
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: bandColor(band),
          boxShadow: "0 0 0 2px var(--bg)",
        }}
      />
    </div>
  );
}

/** Political bands only, in spectrum order — the shape every outlet visual shares. */
export type BandCounts = Partial<Record<Exclude<Band, "NC">, number>>;

export const POLITICAL_BANDS: Exclude<Band, "NC">[] = ["E3", "E2", "E1", "C", "D1", "D2", "D3"];

/** Below this many political articles the 90-day shape is noise, not signal. */
export const SMALL_SAMPLE = 30;

/**
 * Outlet-level diverging bar (Veículos redesign, owner decision 2026-09-04):
 * the seven bands hung on one centre axis. E1→E3 grow leftward from the axis,
 * D1→D3 rightward, C straddles it half and half, tints darken away from the
 * centre (BAND_TONE). Each arm is a full half-track, so a 100%-left outlet
 * fills the left half exactly and nothing can ever overflow. The bar never
 * draws a mean and never prints a number — the position of an outlet is a
 * distribution, not a verdict (spec §2). `mark` drops a dot on one band: the
 * event page uses it to say "this article sits here in its outlet's shape".
 */
export type OutletSide = "esquerda" | "centro" | "direita";
export const OUTLET_SIDE_LABEL: Record<OutletSide, string> = {
  esquerda: "Esquerda",
  centro: "Centro",
  direita: "Direita",
};

/** Mean band lies within this many bands of the centre → the outlet is "centro". */
const OUTLET_SIDE_THRESHOLD = 0.35;

/**
 * Which side an outlet's 90-day shape leans to. Computed from the mean band
 * (E3=-3 … D3=+3) and used ONLY as a coarse label / column key: the mean
 * itself is never rendered anywhere. No political articles → centro.
 */
export function outletSide(counts: BandCounts, politicalArticles: number): OutletSide {
  if (politicalArticles === 0) return "centro";
  let sum = 0;
  POLITICAL_BANDS.forEach((b, i) => {
    sum += (counts[b] ?? 0) * (i - 3);
  });
  const mean = sum / politicalArticles;
  if (mean < -OUTLET_SIDE_THRESHOLD) return "esquerda";
  if (mean > OUTLET_SIDE_THRESHOLD) return "direita";
  return "centro";
}

export function DivergingBar({
  counts,
  politicalArticles,
  mark,
  delayMs,
  tooltip,
}: {
  counts: BandCounts;
  politicalArticles: number;
  mark?: Band | null;
  /** Load-animation stagger (CSS custom property; reduced-motion neutralises it). */
  delayMs?: number;
  /** One tooltip for the whole bar; replaces the per-segment band tooltips. */
  tooltip?: string;
}) {
  if (politicalArticles === 0) {
    return (
      <span className="pc-dbar-empty" role="img" aria-label="sem artigos políticos em 90 dias">
        sem artigos políticos em 90 d
      </span>
    );
  }
  const n = (b: Exclude<Band, "NC">) => counts[b] ?? 0;
  const half = n("C") / 2;
  const pct = (x: number) => (x / politicalArticles) * 100;
  const pctLabel = (x: number) => {
    const p = pct(x);
    return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
  };
  // `x` is the drawn width; `shown` is the number the tooltip states — they
  // differ only for the two Centro halves, which each draw C/2 but mean C.
  const seg = (x: number, band: Exclude<Band, "NC">, key: string, shown = x) =>
    x > 0 ? (
      <i
        key={key}
        title={tooltip ? undefined : `${BAND_LABEL[band]}: ${Math.round(shown)} (${pctLabel(shown)})`}
        style={{ width: `${pct(x)}%`, background: BAND_TONE[band] }}
      />
    ) : null;
  // Left arm reads axis→tip in DOM order, so it is E3 E2 E1 C/2 with
  // justify-content:flex-end; right arm is C/2 D1 D2 D3.
  const left = [seg(n("E3"), "E3", "E3"), seg(n("E2"), "E2", "E2"), seg(n("E1"), "E1", "E1"), seg(half, "C", "CL", n("C"))];
  const right = [seg(half, "C", "CR", n("C")), seg(n("D1"), "D1", "D1"), seg(n("D2"), "D2", "D2"), seg(n("D3"), "D3", "D3")];

  // Dot position for `mark`: the centre of that band's segment, as a % of the
  // full track (axis = 50%). C sits on the axis itself.
  let markLeft: number | null = null;
  // A band with no articles in the window has no segment to sit on — an
  // article older than 90 days gets no dot (the caller says so in words).
  if (mark && mark !== "NC" && n(mark) > 0) {
    if (mark === "C") markLeft = 50;
    else if (mark.startsWith("E")) {
      const order: Exclude<Band, "NC">[] = ["E1", "E2", "E3"];
      let acc = half;
      for (const b of order) {
        if (b === mark) { markLeft = 50 - pct(acc + n(b) / 2) / 2; break; }
        acc += n(b);
      }
    } else {
      const order: Exclude<Band, "NC">[] = ["D1", "D2", "D3"];
      let acc = half;
      for (const b of order) {
        if (b === mark) { markLeft = 50 + pct(acc + n(b) / 2) / 2; break; }
        acc += n(b);
      }
    }
  }
  const small = politicalArticles < SMALL_SAMPLE;
  const label = POLITICAL_BANDS.filter((b) => n(b) > 0)
    .map((b) => `${BAND_LABEL[b]} ${pctLabel(n(b))}`)
    .join(", ");

  return (
    <div
      className={`pc-dbar${small ? " is-small" : ""}`}
      role="img"
      aria-label={tooltip ?? `Distribuição de 90 dias: ${label}`}
      title={tooltip}
      style={delayMs !== undefined ? ({ "--pc-d": `${delayMs}ms` } as React.CSSProperties) : undefined}
    >
      <div className="pc-dbar-arm l">{left}</div>
      <div className="pc-dbar-arm r">{right}</div>
      <div className="pc-dbar-axis" />
      {markLeft !== null && mark && (
        <span
          className="pc-dbar-mark"
          title={tooltip ?? `Este artigo: ${BAND_LABEL[mark]}`}
          style={{ left: `${markLeft}%`, background: BAND_TONE[mark as Exclude<Band, "NC">] }}
        />
      )}
    </div>
  );
}

/**
 * Seven-band silhouette (the "impressão digital"): the same counts as a
 * smooth area over seven fixed columns, filled by a left→right side gradient
 * so colour is position, not decoration. Heights are shares of the outlet's
 * own political articles, so every outlet renders on the same scale and the
 * shapes compare. Detail-only: it never carries a number.
 */
export function BandSilhouette({
  counts,
  politicalArticles,
}: {
  counts: BandCounts;
  politicalArticles: number;
}) {
  if (politicalArticles === 0) return null;
  const w = 300, h = 64, pad = 6;
  const colW = (w - 2 * pad) / 6;
  const pts = POLITICAL_BANDS.map((b, i) => [
    pad + i * colW,
    h - 4 - ((counts[b] ?? 0) / politicalArticles) * (h - 8),
  ]);
  let d = `M ${pad} ${h - 4} L ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < 6; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, 6)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  d += ` L ${w - pad} ${h - 4} Z`;
  const small = politicalArticles < SMALL_SAMPLE;
  return (
    <svg className="pc-sil" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Formato da distribuição por faixa, 90 dias">
      <defs>
        <linearGradient id="pc-sil-grad" x1="0" x2="1">
          <stop offset="0" stopColor="var(--vies-esquerda)" />
          <stop offset="0.5" stopColor="var(--vies-centro)" />
          <stop offset="1" stopColor="var(--vies-direita)" />
        </linearGradient>
      </defs>
      <line x1={pad} y1={h - 4} x2={w - pad} y2={h - 4} stroke="var(--border)" />
      <line x1={w / 2} y1={4} x2={w / 2} y2={h - 4} stroke="var(--border)" strokeDasharray="2 3" />
      {POLITICAL_BANDS.map((b, i) => (
        <line key={b} x1={pad + i * colW} y1={h - 4} x2={pad + i * colW} y2={h - 8} stroke="var(--border)" />
      ))}
      <path
        d={d}
        fill="url(#pc-sil-grad)"
        fillOpacity={small ? 0.35 : 0.85}
        stroke="url(#pc-sil-grad)"
        strokeWidth="1.5"
        strokeDasharray={small ? "3 3" : undefined}
      />
    </svg>
  );
}

export type DistributionCounts = {
  esquerda: number;
  centro: number;
  direita: number;
};

/**
 * Outlet-level coverage distribution: 100% stacked bar of the 90-day political
 * aggregate grouped by side. NC is excluded upstream (Addendum 01 §A2) — the
 * caption's denominator makes that visible.
 */
export function DistributionBar({
  counts,
  politicalArticles,
  ncArticles,
}: {
  counts: DistributionCounts;
  politicalArticles: number;
  ncArticles: number;
}) {
  if (politicalArticles === 0) {
    return (
      <span className="muted" style={{ fontSize: "var(--fs-data)" }}>
        sem artigos políticos classificados (90d){ncArticles > 0 ? ` — ${ncArticles} NC` : ""}
      </span>
    );
  }
  const segments = [
    { key: "Esquerda", n: counts.esquerda, color: "var(--vies-esquerda)" },
    { key: "Centro", n: counts.centro, color: "var(--vies-centro)" },
    { key: "Direita", n: counts.direita, color: "var(--vies-direita)" },
  ].filter((s) => s.n > 0);

  return (
    <div style={{ minWidth: 160, maxWidth: 220 }}>
      <div style={{ display: "flex", gap: 2, height: 8 }}>
        {segments.map((s) => (
          <div
            key={s.key}
            title={`${s.key}: ${s.n} artigo${s.n === 1 ? "" : "s"} (${Math.round((s.n / politicalArticles) * 100)}%)`}
            style={{
              width: `${(s.n / politicalArticles) * 100}%`,
              background: s.color,
              minWidth: 3,
            }}
          />
        ))}
      </div>
      <div className="muted" style={{ fontSize: "var(--fs-data)", marginTop: 3 }}>
        média 90d ({politicalArticles} artigo{politicalArticles === 1 ? "" : "s"} político
        {politicalArticles === 1 ? "" : "s"}; {ncArticles} NC excluído{ncArticles === 1 ? "" : "s"})
      </div>
    </div>
  );
}
