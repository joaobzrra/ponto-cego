/*
 * Newsletter composition rules (spec 2026-09-04 §1). Pure and DB-free so the
 * ordering, the weekday rotation and the no-repeat rule are unit-tested. The
 * DB queries that feed them live in lib/newsletter.ts.
 */
export type IssueSides = { esquerda: number; centro: number; direita: number };
export type IssueItem = {
  clusterId: number;
  headline: string;
  outlet: string;
  sides: IssueSides;
  url: string;
  line?: string;
  weakSide?: "esquerda" | "direita";
  weakShare?: number;
};
export type Issue = {
  version: 1;
  date: string;
  top: IssueItem | null;
  middle: IssueItem[];
  bottom: { category: string; item: IssueItem } | null;
  second: IssueItem | null;
  composedAt: string;
};

const TZ = "America/Sao_Paulo";

/** Sunday-first so index === Date#getUTCDay(). Owner ruling 2026-09-04. */
export const CATEGORY_ROTATION = [
  "Justiça e Segurança", // Sun
  "Geopolítica",         // Mon
  "Saúde",               // Tue
  "Economia",            // Wed
  "Educação",            // Thu
  "Meio Ambiente",       // Fri
  "Cultura",             // Sat
] as const;

const dateFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" });

export function brtDate(now: Date): string {
  return dateFmt.format(now);
}

export function brtHour(now: Date): number {
  return Number(hourFmt.format(now));
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function categoryOrder(date: string): string[] {
  const start = weekdayOf(date);
  return Array.from({ length: 7 }, (_, i) => CATEGORY_ROTATION[(start + i) % 7]);
}

export function pickBlindspots<T extends { clusterId: number; subject: string | null }>(
  ranked: T[],
  recentClusterIds: Set<number>,
): { top: T | null; second: T | null } {
  const fresh = ranked.filter((b) => !recentClusterIds.has(b.clusterId));
  const top = fresh[0] ?? null;
  if (!top) return { top: null, second: null };
  const second =
    fresh.find((b) => b.clusterId !== top.clusterId && (b.subject === null || b.subject !== top.subject)) ?? null;
  return { top, second };
}

/**
 * The second blindspot, picked AFTER top/middle/bottom are already resolved
 * (spec §1: top → middle → bottom → second, cumulative exclusions) — so
 * `exclude` here is the union of every cluster already used plus the 7-day
 * no-repeat set, not just the no-repeat set `pickBlindspots` uses for `top`.
 * Same subject rule as `pickBlindspots`: null subject or a different one
 * than `top`'s, so Lula-vs-Lula never fills both blindspot slots.
 */
export function pickSecondBlindspot<T extends { clusterId: number; subject: string | null }>(
  ranked: T[],
  top: T,
  exclude: Set<number>,
): T | null {
  return (
    ranked.find(
      (b) => b.clusterId !== top.clusterId && !exclude.has(b.clusterId) && (b.subject === null || b.subject !== top.subject),
    ) ?? null
  );
}

export function issueUrl(base: string, clusterId: number, date: string): string {
  return `${base}/e/${clusterId}?utm_source=newsletter&utm_medium=email&utm_campaign=${date}`;
}

export function issueIsEmpty(i: Pick<Issue, "top" | "middle" | "bottom">): boolean {
  return i.top === null && i.bottom === null && i.middle.length < 3;
}
