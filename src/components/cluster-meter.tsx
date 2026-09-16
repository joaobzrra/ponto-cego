import type { ClusterAggregate } from "@/lib/classification";

/*
 * Cluster coverage meter — the Destaque distribution bar's visual language
 * (stacked esquerda/centro/direita) in a compact form for cluster surfaces:
 * the front page cards and the Ponto Cego na Mídia rail. Counts are DISTINCT
 * OUTLETS per side (blindspot math), not article volume.
 *
 * `weakSide` names the blindspot explicitly: an absent segment reads as
 * nothing, so the asymmetry is spelled out in text — never color/gap alone.
 *
 * Label modes (Final-Wireframe 2026-07-18):
 *   percent       — "33%  33%  33%" row ABOVE the bar (front-page card grammar)
 *   percent-below — same row UNDER the bar (the hero's under-title stack)
 *   counts        — "3 esquerda · …" row below the bar (thread/detail surfaces)
 *   inside        — tall bar with the % drawn inside each segment (hero and
 *                   Tópicos em Alta; segments under 14% carry no text)
 *   none          — bar only (narrow rails; at the 12px floor labels overflow)
 */
export function ClusterMeter({
  sides,
  weakSide,
  compact = false,
  labels,
}: {
  sides: ClusterAggregate["outletsBySide"];
  weakSide?: "esquerda" | "direita";
  /** Back-compat shorthand for labels="none". */
  compact?: boolean;
  labels?: "counts" | "percent" | "percent-below" | "inside" | "none";
}) {
  const mode = labels ?? (compact ? "none" : "counts");
  const total = sides.esquerda + sides.centro + sides.direita;
  if (total === 0) return null;
  const segs = [
    { label: "esquerda", n: sides.esquerda, color: "var(--vies-esquerda)" },
    { label: "centro", n: sides.centro, color: "var(--vies-centro)" },
    { label: "direita", n: sides.direita, color: "var(--vies-direita)" },
  ];
  // Labels take the SAME widths as the bar segments, so each % sits centered
  // on its own segment and moves with it. n=0 sides render no label at all.
  const pcts = (
    <div className="pc-cmeter-pcts">
      {segs.map(
        (s) =>
          s.n > 0 && (
            <span key={s.label} style={{ width: `${(s.n / total) * 100}%`, color: s.color }}>
              {Math.round((s.n / total) * 100)}%
            </span>
          ),
      )}
    </div>
  );
  return (
    <div className="pc-cmeter">
      {mode === "percent" && pcts}
      <div
        className={mode === "inside" ? "pc-cmeter-bar pc-cmeter-bar--inside" : "pc-cmeter-bar"}
        role="img"
        aria-label={segs.map((s) => `${s.label}: ${s.n} veículos`).join(", ")}
      >
        {segs.map(
          (s) =>
            s.n > 0 && (
              <div
                key={s.label}
                title={`${s.label}: ${s.n} veículo${s.n === 1 ? "" : "s"}`}
                style={{ width: `${(s.n / total) * 100}%`, background: s.color }}
              >
                {mode === "inside" && s.n / total >= 0.14 && (
                  <span>{Math.round((s.n / total) * 100)}%</span>
                )}
              </div>
            ),
        )}
      </div>
      {mode === "percent-below" && pcts}
      {mode === "counts" && (
        <div className="pc-cmeter-labels">
          {segs.map((s) => (
            <span key={s.label} style={{ color: s.n > 0 ? s.color : "var(--text-faint)" }}>
              {s.n} {s.label}
            </span>
          ))}
        </div>
      )}
      {weakSide && (
        <div className="pc-cmeter-note">
          ponto cego à <strong style={{ color: `var(--vies-${weakSide})` }}>{weakSide}</strong> —{" "}
          {mode === "none" ? (
            <>
              {sides[weakSide]}/{total} veículos
            </>
          ) : (
            <>
              {sides[weakSide]} de {total} veículos
            </>
          )}
        </div>
      )}
    </div>
  );
}
