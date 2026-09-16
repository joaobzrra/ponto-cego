import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, tables } from "@/db";

/**
 * Feed health (spec §5 + Addendum 01 §A1): three states, computed from
 * fetch_runs PER FEED — a política feed publishing 8/day and a geral feed
 * publishing 100/day must not share a Degraded threshold.
 * - offline:  the last CONSECUTIVE_FAILURES runs all failed at the network level.
 * - degraded: reachable, but parsing fails, or 0 new articles in 6h while the
 *   feed's own trailing-7-day baseline says it should have published — the
 *   silent-parse-failure state that matters most.
 * - online:   everything else (with data).
 * - pending:  no runs yet (just onboarded).
 */
export type HealthState = "online" | "degraded" | "offline" | "pending";

export type FeedHealth = {
  feedId: number;
  feedUrl: string;
  scope: string;
  outletId: number;
  name: string;
  slug: string;
  /** Effective: the feed only polls when both outlet and feed are enabled. */
  enabled: boolean;
  state: HealthState;
  reason: string;
  lastSuccessfulFetch: Date | null;
  lastSuccessfulParse: Date | null;
  new6h: number;
  new24h: number;
  /** Expected new articles per 6h from the feed's own trailing 7 days. */
  baselinePer6h: number;
};

const CONSECUTIVE_FAILURES = 3;
const WINDOW_6H_MS = 6 * 60 * 60 * 1000;
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000;

type FeedWithOutlet = {
  feed: typeof tables.feeds.$inferSelect;
  outlet: typeof tables.outlets.$inferSelect;
};

export async function computeFeedHealth({ feed, outlet }: FeedWithOutlet): Promise<FeedHealth> {
  const now = Date.now();

  const [recentRuns, [agg]] = await Promise.all([
    db
      .select({
        fetchOk: tables.fetchRuns.fetchOk,
        parseOk: tables.fetchRuns.parseOk,
        startedAt: tables.fetchRuns.startedAt,
      })
      .from(tables.fetchRuns)
      .where(eq(tables.fetchRuns.feedId, feed.id))
      .orderBy(desc(tables.fetchRuns.startedAt))
      .limit(CONSECUTIVE_FAILURES),
    db
      .select({
        lastFetch: sql<string | null>`max(${tables.fetchRuns.startedAt}) filter (where ${tables.fetchRuns.fetchOk})`,
        lastParse: sql<string | null>`max(${tables.fetchRuns.startedAt}) filter (where ${tables.fetchRuns.parseOk})`,
        new6h: sql<number>`coalesce(sum(${tables.fetchRuns.articlesNew}) filter (where ${tables.fetchRuns.startedAt} > ${new Date(now - WINDOW_6H_MS)}), 0)`,
        new24h: sql<number>`coalesce(sum(${tables.fetchRuns.articlesNew}) filter (where ${tables.fetchRuns.startedAt} > ${new Date(now - WINDOW_24H_MS)}), 0)`,
        new7d: sql<number>`coalesce(sum(${tables.fetchRuns.articlesNew}) filter (where ${tables.fetchRuns.startedAt} > ${new Date(now - WINDOW_7D_MS)}), 0)`,
        maxRun7d: sql<number>`coalesce(max(${tables.fetchRuns.articlesNew}) filter (where ${tables.fetchRuns.startedAt} > ${new Date(now - WINDOW_7D_MS)}), 0)`,
      })
      .from(tables.fetchRuns)
      .where(
        and(
          eq(tables.fetchRuns.feedId, feed.id),
          gt(tables.fetchRuns.startedAt, new Date(now - WINDOW_7D_MS)),
        ),
      ),
  ]);

  const base = {
    feedId: feed.id,
    feedUrl: feed.url,
    scope: feed.scope,
    outletId: outlet.id,
    name: outlet.name,
    slug: outlet.slug,
    enabled: outlet.enabled && feed.enabled,
    lastSuccessfulFetch: agg.lastFetch ? new Date(agg.lastFetch) : null,
    lastSuccessfulParse: agg.lastParse ? new Date(agg.lastParse) : null,
    new6h: Number(agg.new6h),
    new24h: Number(agg.new24h),
    // Discount the single largest run: onboarding backfill (or any one-off
    // burst) lands as ONE run and must not prove the feed "normally
    // publishes" — Brasil Paralelo's artigos feed sat degraded for days on a
    // 50-article backfill baseline (2026-07-17). Steady feeds lose one run
    // out of ~1000 and keep their baseline.
    baselinePer6h:
      (Number(agg.new7d) - Number(agg.maxRun7d)) / (WINDOW_7D_MS / WINDOW_6H_MS),
  };

  if (recentRuns.length === 0) {
    return { ...base, state: "pending", reason: "Nenhuma coleta ainda" };
  }

  if (
    recentRuns.length >= CONSECUTIVE_FAILURES &&
    recentRuns.every((r) => !r.fetchOk)
  ) {
    return {
      ...base,
      state: "offline",
      reason: `Últimas ${CONSECUTIVE_FAILURES} coletas falharam`,
    };
  }

  const latest = recentRuns[0];
  if (latest.fetchOk && !latest.parseOk) {
    return { ...base, state: "degraded", reason: "Feed acessível mas não parseável" };
  }

  // The feed normally publishes (baseline ≥ 1/6h) but produced nothing in 6h.
  if (base.new6h === 0 && base.baselinePer6h >= 1) {
    return {
      ...base,
      state: "degraded",
      reason: `0 artigos novos em 6h (baseline ~${base.baselinePer6h.toFixed(1)}/6h)`,
    };
  }

  return { ...base, state: "online", reason: "Coletando normalmente" };
}

export async function computeAllHealth(): Promise<FeedHealth[]> {
  const rows = await db
    .select({ feed: tables.feeds, outlet: tables.outlets })
    .from(tables.feeds)
    .innerJoin(tables.outlets, eq(tables.outlets.id, tables.feeds.outletId))
    .orderBy(tables.outlets.name, tables.feeds.id);
  return Promise.all(rows.map(computeFeedHealth));
}
