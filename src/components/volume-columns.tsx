/**
 * Daily-volume column chart (server component, inline SVG, zero dependencies —
 * repo rule: CSS/SVG primitives over chart libraries).
 *
 * Form: stacked columns per day — "termo no título" (strong) at the baseline,
 * "só menção" (faint) above it; the stack's height is the day's total. The
 * prior/baseline window renders dimmed (context), the current window at full
 * strength, a hairline divider between them. Y-axis carries clean-numbered
 * ticks with recessive gridlines; the peak and the latest full day get direct
 * value labels (selective — never every point). Today is partial by
 * definition and is marked as such. Every column carries a native <title>
 * tooltip with the exact numbers.
 */

export type VolumePoint = {
  /** Local day key yyyy-mm-dd. */
  day: string;
  total: number;
  inTitle: number;
};

const W = 920;
const H = 210;
const PAD_L = 44; // room for y tick labels
const PAD_R = 8;
const PAD_T = 18; // room for direct labels above tall columns
const PAD_B = 20;
const BAR_MAX = 24;
const STACK_GAP = 2;

/** Round up to a clean tick ceiling (1/2/2.5/5 × 10^k). */
function niceCeil(v: number): number {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

export function VolumeColumns({
  points,
  splitIndex,
  todayKey,
}: {
  /** Oldest first, one point per day (dense — include zero days). */
  points: VolumePoint[];
  /** Index of the first day of the CURRENT window (divider goes before it). */
  splitIndex: number;
  /** Local day key of today — rendered as partial. */
  todayKey: string;
}) {
  const n = points.length;
  if (n === 0) return <p className="muted">Sem dados ainda.</p>;

  const yMax = niceCeil(Math.max(1, ...points.map((p) => p.total)));
  const ticks = [0, yMax / 4, yMax / 2, (3 * yMax) / 4, yMax].map(Math.round);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const band = plotW / n;
  const barW = Math.min(BAR_MAX, band * 0.62);
  const x = (i: number) => PAD_L + i * band + (band - barW) / 2;
  const y = (v: number) => PAD_T + plotH - (v / yMax) * plotH;
  const baseline = PAD_T + plotH;

  // Selective direct labels: the peak, and the latest FULL day (today is
  // partial, labeling it would understate the day).
  const peakIdx = points.reduce((b, p, i) => (p.total > points[b].total ? i : b), 0);
  let lastFullIdx = n - 1;
  while (lastFullIdx >= 0 && points[lastFullIdx].day === todayKey) lastFullIdx--;
  const labeled = new Set([peakIdx, lastFullIdx].filter((i) => i >= 0 && points[i].total > 0));

  // Sparse x labels: first, divider, last full, today.
  const xLabels = new Set([0, splitIndex, n - 1]);

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label="Volume diário de artigos, janela anterior e atual"
      >
        {/* gridlines + y ticks (recessive, hairline) */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--border-faint)"
              strokeWidth="1"
            />
            <text
              x={PAD_L - 6}
              y={y(t) + 3}
              fontSize="10"
              fill="var(--text-faint)"
              textAnchor="end"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {t}
            </text>
          </g>
        ))}

        {/* window divider */}
        {splitIndex > 0 && splitIndex < n && (
          <line
            x1={PAD_L + splitIndex * band}
            x2={PAD_L + splitIndex * band}
            y1={PAD_T - 6}
            y2={baseline}
            stroke="var(--border)"
            strokeWidth="1"
          />
        )}

        {/* columns */}
        {points.map((p, i) => {
          const isToday = p.day === todayKey;
          const dim = i < splitIndex;
          const opacity = isToday ? 0.7 : dim ? 0.45 : 1;
          const mention = p.total - p.inTitle;
          const titleTop = y(p.inTitle);
          const totalTop = y(p.total);
          const r = 4; // rounded data-end, square baseline
          return (
            <g key={p.day} opacity={opacity}>
              <title>
                {`${ddmm(p.day)}${isToday ? " (hoje, parcial)" : ""} — ${p.total} artigos, ${p.inTitle} com o termo no título`}
              </title>
              {/* invisible full-band hit target so the tooltip is easy to hit */}
              <rect x={PAD_L + i * band} y={PAD_T} width={band} height={plotH} fill="transparent" />
              {p.inTitle > 0 && (
                <path
                  d={
                    mention > 0
                      ? `M ${x(i)} ${baseline} V ${titleTop} H ${x(i) + barW} V ${baseline} Z`
                      : `M ${x(i)} ${baseline} V ${titleTop + r} Q ${x(i)} ${titleTop} ${x(i) + r} ${titleTop} H ${x(i) + barW - r} Q ${x(i) + barW} ${titleTop} ${x(i) + barW} ${titleTop + r} V ${baseline} Z`
                  }
                  fill="var(--text)"
                />
              )}
              {mention > 0 && (
                <path
                  d={`M ${x(i)} ${(p.inTitle > 0 ? titleTop - STACK_GAP : baseline)} V ${totalTop + r} Q ${x(i)} ${totalTop} ${x(i) + r} ${totalTop} H ${x(i) + barW - r} Q ${x(i) + barW} ${totalTop} ${x(i) + barW} ${totalTop + r} V ${(p.inTitle > 0 ? titleTop - STACK_GAP : baseline)} Z`}
                  fill="var(--text-faint)"
                />
              )}
              {labeled.has(i) && (
                <text
                  x={x(i) + barW / 2}
                  y={totalTop - 5}
                  fontSize="11"
                  fill="var(--text-dim)"
                  textAnchor="middle"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {p.total}
                </text>
              )}
            </g>
          );
        })}

        {/* x labels */}
        {points.map((p, i) => {
          if (!xLabels.has(i)) return null;
          const isToday = p.day === todayKey;
          return (
            <text
              key={p.day}
              x={PAD_L + i * band + band / 2}
              y={H - 6}
              fontSize="10"
              fill="var(--text-faint)"
              textAnchor="middle"
            >
              {isToday ? "hoje" : ddmm(p.day)}
            </text>
          );
        })}
        {splitIndex > 0 && splitIndex < n && (
          <text
            x={PAD_L + splitIndex * band - 4}
            y={PAD_T - 8}
            fontSize="9"
            fill="var(--text-faint)"
            textAnchor="end"
            style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            janela anterior
          </text>
        )}
        {splitIndex > 0 && splitIndex < n && (
          <text
            x={PAD_L + splitIndex * band + 4}
            y={PAD_T - 8}
            fontSize="9"
            fill="var(--text-dim)"
            textAnchor="start"
            style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            janela atual
          </text>
        )}
      </svg>
      {/* legend — two series, so always present */}
      <p className="muted" style={{ fontSize: "0.75rem", margin: "0.35rem 0 0" }}>
        <span style={{ marginRight: "1rem" }}>
          <span style={{ color: "var(--text)" }}>▮</span> termo no título
        </span>
        <span style={{ marginRight: "1rem" }}>
          <span style={{ color: "var(--text-faint)" }}>▮</span> só menção (palavra-chave)
        </span>
        <span>passe o mouse sobre uma coluna para os números exatos</span>
      </p>
    </div>
  );
}
