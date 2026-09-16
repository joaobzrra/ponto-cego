/**
 * Generic per-outlet provenance warning (outlets.warning_label): a red badge
 * rendered next to the outlet name on every article surface, always to the
 * LEFT of the bias bar. Factual labels only (first use: "Estatal Russa") —
 * the badge states provenance, never editorial judgment.
 */
export function WarningBadge({ label }: { label: string | null | undefined }) {
  if (!label) return null;
  return <span className="pc-warn-badge">{label}</span>;
}
