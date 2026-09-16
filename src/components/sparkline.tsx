/**
 * Hand-rolled inline-SVG line chart (server component, zero dependencies —
 * repo rule: CSS/SVG primitives over chart libraries). Multiple series share
 * one y-scale; days label the x-axis sparsely.
 */
export type SparkSeries = {
  label: string;
  color: string;
  values: number[];
};

export function Sparkline({
  days,
  series,
  height = 120,
}: {
  /** X labels, one per point (e.g. "12/07"). */
  days: string[];
  series: SparkSeries[];
  height?: number;
}) {
  const width = 640;
  const padX = 6;
  const padY = 10;
  const n = days.length;
  if (n === 0) return <p className="muted">Sem dados ainda.</p>;

  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => (n === 1 ? width / 2 : padX + (i * (width - 2 * padX)) / (n - 1));
  const y = (v: number) => height - padY - (v / max) * (height - 2 * padY);
  const points = (values: number[]) =>
    values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  // Sparse x labels: first, middle, last.
  const labelIdx = n <= 3 ? days.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height + 16}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label={series.map((s) => s.label).join(" e ")}
      >
        {series.map((s) => (
          <polyline
            key={s.label}
            points={points(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {labelIdx.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={height + 12}
            fontSize="10"
            fill="var(--text-faint)"
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
          >
            {days[i]}
          </text>
        ))}
      </svg>
      <p className="muted" style={{ fontSize: "0.75rem", margin: "0.25rem 0 0" }}>
        {series.map((s, i) => (
          <span key={s.label} style={{ marginRight: "1rem" }}>
            <span style={{ color: s.color }}>▬</span> {s.label}
            {i === series.length - 1 ? ` · máx ${max}` : ""}
          </span>
        ))}
      </p>
    </div>
  );
}
