/*
 * Blindspot ranking (spec §3, ledger CLM-blindspot-week-min-age-one-per-subject).
 * Pure: the SQL in classification.ts produces candidates, this decides which
 * are blindspots and in what order. Exactly ONE side at or under maxShare
 * (both thin = centre-only story, not a blindspot). Rank: weak share asc,
 * total outlets desc, last article desc. One card per subject so Lula or
 * Moraes cannot fill the rail.
 */
export type BlindspotCandidate = {
  clusterId: number;
  title: string;
  sides: { esquerda: number; centro: number; direita: number };
  politicalArticles: number;
  subject: string | null;
  keywords: string[];
  thumbnailPath: string | null;
  firstAt: Date;
  lastAt: Date;
};

export type Blindspot = BlindspotCandidate & {
  /**
   * Sum of the three per-side DISTINCT outlet counts, not a distinct count
   * over the whole cluster: an outlet that published two articles banded on
   * different sides is counted once per side, so this can exceed the cluster's
   * real outlet count. Same arithmetic as `clusterSides` in `home.ts`, which
   * is what the meter draws — the caption and the meter therefore agree.
   */
  totalOutlets: number;
  weakSide: "esquerda" | "direita";
  weakShare: number;
};

export function rankBlindspots(
  rows: BlindspotCandidate[],
  opts: { maxShare?: number; onePerSubject?: boolean } = {},
): Blindspot[] {
  const maxShare = opts.maxShare ?? 0.2;
  const onePerSubject = opts.onePerSubject ?? true;
  const ranked: Blindspot[] = [];
  for (const r of rows) {
    const total = r.sides.esquerda + r.sides.centro + r.sides.direita;
    if (total === 0) continue;
    const weak = (["esquerda", "direita"] as const).filter((s) => r.sides[s] / total <= maxShare);
    if (weak.length !== 1) continue;
    ranked.push({ ...r, totalOutlets: total, weakSide: weak[0], weakShare: r.sides[weak[0]] / total });
  }
  ranked.sort(
    (a, b) =>
      a.weakShare - b.weakShare ||
      b.totalOutlets - a.totalOutlets ||
      b.lastAt.getTime() - a.lastAt.getTime() ||
      a.clusterId - b.clusterId,
  );
  if (!onePerSubject) return ranked;
  const seen = new Set<string>();
  return ranked.filter((b) => {
    if (b.subject === null) return true;
    if (seen.has(b.subject)) return false;
    seen.add(b.subject);
    return true;
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "(N veículos · hoje)" window word for a story that started `firstAt`. */
export function ageCaption(firstAt: Date, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - firstAt.getTime()) / DAY_MS);
  if (days <= 0) return "hoje";
  return days === 1 ? "há 1 dia" : `há ${days} dias`;
}
