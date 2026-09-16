/**
 * "Viés em Debate" (2026-07-14, user request): when the classifier's
 * confidence in a banded article is below the threshold, the label is
 * publicly marked as under debate — an honesty signal that doubles as an
 * invitation to vote. NC and unclassified articles never show it.
 */
export const DEBATE_CONFIDENCE = 0.65;

export function inDebate(band: string | null, confidence: number | null): boolean {
  return band != null && band !== "NC" && confidence != null && confidence < DEBATE_CONFIDENCE;
}

export function DebateBadge({
  band,
  confidence,
}: {
  band: string | null;
  confidence: number | null;
}) {
  if (!inDebate(band, confidence)) return null;
  return (
    <span className="pc-debate-badge" title="Confiança baixa — vote e ajude a calibrar">
      Viés em Debate
    </span>
  );
}
