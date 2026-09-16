/**
 * Stage 5 core (spec §3.4): wire-copy dedup FIRST, then event clustering.
 * Both operate on embedded, published, non-duplicate articles within a 72h
 * window. Thresholds are env-tunable; scripts/tune-clustering.ts prints real
 * similarity distributions to pick them (see OPUS-HANDOFF.md step 2).
 *
 * dryRun mode computes and RETURNS decisions without writing — used by the
 * smoke test and threshold tuning; the enabled pipeline calls with dryRun off.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { clusterConfirmPrompt, parseClusterConfirm } from "@/lib/llm-cluster";
import {
  estimateNovitaUsd,
  getSpendToday,
  NOVITA_MODEL_ID,
  novitaChat,
  novitaEnabled,
  ProviderError,
} from "@/lib/llm";

/**
 * Gate for the review-band confirm. Off by default: it spends money per
 * borderline pair, so it must be an explicit choice, and turning it off
 * restores the previous (leave-unassigned) behaviour exactly.
 */
export const CLUSTER_CONFIRM_ENABLED = process.env.CLUSTER_CONFIRM_ENABLED === "1";
/** Attach only on a confident yes; everything else gets its own cluster. */
export const CLUSTER_CONFIRM_MIN_CONF = Number(process.env.CLUSTER_CONFIRM_MIN_CONF ?? 0.7);

export const DEDUP_THRESHOLD = Number(process.env.DEDUP_THRESHOLD ?? 0.97);
export const CLUSTER_ATTACH = Number(process.env.CLUSTER_ATTACH ?? 0.86);
export const CLUSTER_REVIEW = Number(process.env.CLUSTER_REVIEW ?? 0.78);
const WINDOW_HOURS = 72;
/**
 * A cluster only accepts new members for this long after creation (user
 * decision 2026-07-17): a recurring topic past the window starts a FRESH
 * cluster instead of reviving a stale one, so /topicos always shows events
 * at most one news cycle old. Dedup keeps the full 72h window — wire copy
 * is about the article, not the event.
 */
export const CLUSTER_MAX_AGE_HOURS = Number(process.env.CLUSTER_MAX_AGE_HOURS ?? 24);

export type DupDecision = {
  articleId: number;
  title: string;
  outlet: string;
  duplicateOf: number;
  dupTitle: string;
  dupOutlet: string;
  similarity: number;
};

/**
 * Marks cross-outlet near-duplicates (syndicated wire copy) so they're
 * excluded from spectrum math. Same-outlet duplicates are the GUID/rescope
 * system's job, not ours.
 */
export async function markDuplicates(dryRun: boolean): Promise<DupDecision[]> {
  /*
   * Candidates: embedded, published, and NOT YET CHECKED.
   *
   * The lateral below only ever looks backward (`d.id < a.id`), so the set an
   * article is compared against is frozen when it arrives: if A finds no
   * duplicate, no later arrival can change that — B checks against A, not the
   * reverse. One check per article is therefore sufficient, and the previous
   * `duplicate_of is null` filter re-ran ~8,300 HNSW searches every cycle to
   * discover the ~50 new ones (only 713 articles have EVER been marked a
   * duplicate). That cost ~10 min per cycle, starving the classifier in the
   * sequential tick and holding a read lock long enough to park DDL behind it.
   *
   * Caveat accepted 2026-07-21: an article whose nearest neighbour is later
   * itself marked a duplicate can leave an A->B->C chain. That was already
   * possible (the rule is only "points OLDER"); checking once makes it stick
   * rather than being revisited on the next sweep. To force a re-sweep of any
   * window, clear the stamp and the next cycle redoes exactly those rows:
   *   update articles set dedup_checked_at = null
   *   where fetched_at > now() - interval '7 days' and duplicate_of is null;
   */
  // Freeze the candidate set first: the stamp at the end must cover EXACTLY
  // the rows the search considered, or an article embedded mid-query would be
  // marked checked without ever having been compared.
  //
  // The 72h bound is kept from the original query — outside it an article was
  // never a candidate anyway — which also means the one-off stamp backfill only
  // has to cover that window, not the whole corpus. That matters: `articles`
  // rows carry a 1024-dim vector, so a full-table UPDATE rewrites ~500MB of
  // heap and took >25 min without finishing (attempted and abandoned
  // 2026-07-22). Rows older than the window keep a NULL stamp harmlessly.
  const candidates = await db.execute(sql`
    select id from articles
    where embedding is not null
      and status = 'published'
      and duplicate_of is null
      and dedup_checked_at is null
      and fetched_at > now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'
  `);
  const candidateIds = (candidates.rows as Array<{ id: string | number }>).map((r) => Number(r.id));
  if (candidateIds.length === 0) return [];
  const idList = sql.join(
    candidateIds.map((id) => sql`${id}`),
    sql`, `,
  );

  const result = await db.execute(sql`
    select a.id, a.title, oa.slug as outlet,
           d.id as dup_id, d.title as dup_title, od.slug as dup_outlet,
           1 - (a.embedding <=> d.embedding) as similarity
    from articles a
    join outlets oa on oa.id = a.outlet_id
    cross join lateral (
      select d.id, d.title, d.outlet_id, d.embedding
      from articles d
      where d.embedding is not null
        and d.status = 'published'
        and d.duplicate_of is null
        and d.outlet_id <> a.outlet_id
        and d.id < a.id
        and coalesce(d.published_at, d.fetched_at)
              >= coalesce(a.published_at, a.fetched_at) - interval '${sql.raw(String(WINDOW_HOURS))} hours'
      order by a.embedding <=> d.embedding
      limit 1
    ) d
    join outlets od on od.id = d.outlet_id
    where a.id in (${idList})
      and 1 - (a.embedding <=> d.embedding) >= ${DEDUP_THRESHOLD}
  `);

  const decisions: DupDecision[] = (result.rows as Array<Record<string, unknown>>).map((r) => ({
    articleId: Number(r.id),
    title: String(r.title),
    outlet: String(r.outlet),
    duplicateOf: Number(r.dup_id),
    dupTitle: String(r.dup_title),
    dupOutlet: String(r.dup_outlet),
    similarity: Number(r.similarity),
  }));

  if (!dryRun) {
    for (const d of decisions) {
      await db
        .update(tables.articles)
        .set({ duplicateOf: d.duplicateOf })
        .where(and(eq(tables.articles.id, d.articleId), isNull(tables.articles.duplicateOf)));
    }
    // Stamp the whole candidate set, not just the matches — an article with no
    // duplicate is exactly the case we must never re-examine.
    await db
      .update(tables.articles)
      .set({ dedupCheckedAt: new Date() })
      .where(inArray(tables.articles.id, candidateIds));
  }
  return decisions;
}

export type ClusterDecision = {
  articleId: number;
  title: string;
  action: "attach" | "review" | "new";
  clusterId: number | null;
  nearestTitle: string | null;
  similarity: number | null;
  /** The concrete neighbour that produced `similarity` — the confirm step
   *  compares against THIS article, not a re-derived cluster representative. */
  nearestId?: number | null;
  /** Article timestamp, so a confirm-created cluster backdates like its seed. */
  ts?: Date | null;
};

/**
 * Which "now" the CLUSTER_MAX_AGE_HOURS gate is measured against.
 *
 * "wall"    — real clock. The live cycle: an article joins only clusters that
 *             are still open right now.
 * "article" — the candidate article's own published/fetched time. Backfill
 *             only: it reconstructs what the live cycle WOULD have decided had
 *             it run when the article arrived. Measuring a two-day-old article
 *             against the wall clock would let every backfilled cluster stay
 *             eligible forever and chain unrelated days into mega-clusters —
 *             exactly what the 24h rule exists to prevent.
 */
type TimeRef = "wall" | "article";

function refTime(mode: TimeRef, articleId: number) {
  return mode === "wall"
    ? sql`now()`
    : sql`(select coalesce(published_at, fetched_at) from articles where id = ${articleId})`;
}

type Candidate = { id: number; title: string; ts: Date | null };

/**
 * Greedy incremental clustering. attach ≥ CLUSTER_ATTACH; the review band
 * [CLUSTER_REVIEW, attach) is left UNASSIGNED here — the Haiku confirm step
 * (llm-cluster.ts, API-gated) resolves those pairs; below review → new
 * cluster. In dryRun, "new" clusters are reported but not created.
 *
 * The nearest-neighbor lookup runs PER ARTICLE, after the previous article's
 * assignment was written — a single snapshot query fragments clusters: every
 * same-story article arriving within one cycle sees no clustered neighbor and
 * spawns its own cluster (backfill produced 5,489 singletons and split the
 * TSE-selo story across 9 clusters, user-caught 2026-07-14). N small HNSW
 * lookups per cycle is cheap; dryRun keeps snapshot semantics (no writes to
 * observe) — fine for tuning, which only inspects the similarity histogram.
 *
 * Shared by the live cycle and the backfill so both make byte-identical
 * decisions; they differ only in candidate selection and TimeRef.
 */
async function clusterCandidates(
  candidates: Candidate[],
  opts: { dryRun: boolean; timeRef: TimeRef },
): Promise<ClusterDecision[]> {
  const { dryRun, timeRef } = opts;
  const decisions: ClusterDecision[] = [];

  for (const c of candidates) {
    const articleId = c.id;
    const title = c.title;
    const ref = refTime(timeRef, articleId);

    // The scalar subselects are uncorrelated initplans — evaluated once, so
    // the HNSW index still drives the order by.
    const nearest = await db.execute(sql`
      select n.cluster_id, n.id as nearest_id, n.title as nearest_title,
             1 - (n.embedding <=> (select embedding from articles where id = ${articleId})) as similarity
      from articles n
      join clusters cl on cl.id = n.cluster_id
        and cl.status = 'active'
        and cl.created_at > ${ref} - interval '${sql.raw(String(CLUSTER_MAX_AGE_HOURS))} hours'
      where n.embedding is not null
        and n.status = 'published'
        and n.duplicate_of is null
        and n.cluster_id is not null
        and n.band is not null
        and n.band <> 'NC'
        and n.id <> ${articleId}
        and coalesce(n.published_at, n.fetched_at)
              >= (select coalesce(published_at, fetched_at) from articles where id = ${articleId})
                   - interval '${sql.raw(String(WINDOW_HOURS))} hours'
      order by n.embedding <=> (select embedding from articles where id = ${articleId})
      limit 1
    `);
    const r = (nearest.rows[0] ?? {}) as Record<string, unknown>;
    const sim = r.similarity == null ? null : Number(r.similarity);
    const nearCluster = r.cluster_id == null ? null : Number(r.cluster_id);

    if (sim !== null && nearCluster !== null && sim >= CLUSTER_ATTACH) {
      decisions.push({
        articleId,
        title,
        action: "attach",
        clusterId: nearCluster,
        nearestTitle: String(r.nearest_title),
        similarity: sim,
      });
      if (!dryRun) {
        await db
          .update(tables.articles)
          .set({ clusterId: nearCluster })
          .where(eq(tables.articles.id, articleId));
      }
    } else if (sim !== null && nearCluster !== null && sim >= CLUSTER_REVIEW) {
      // Unassigned here; confirmReviewPairs resolves these when enabled.
      decisions.push({
        articleId,
        title,
        action: "review",
        clusterId: nearCluster,
        nearestTitle: String(r.nearest_title),
        nearestId: r.nearest_id == null ? null : Number(r.nearest_id),
        similarity: sim,
        ts: c.ts,
      });
    } else {
      decisions.push({
        articleId,
        title,
        action: "new",
        clusterId: null,
        nearestTitle: r.nearest_title ? String(r.nearest_title) : null,
        similarity: sim,
      });
      if (!dryRun) {
        const [cluster] = await db
          .insert(tables.clusters)
          // Backdated in backfill mode so the age gate above keeps meaning the
          // same thing for articles placed later, and so a reconstructed
          // cluster never masquerades as breaking news in home.ts's 24h pool.
          .values({ title, ...(timeRef === "article" && c.ts ? { createdAt: c.ts } : {}) })
          .returning({ id: tables.clusters.id });
        await db
          .update(tables.articles)
          .set({ clusterId: cluster.id })
          .where(eq(tables.articles.id, articleId));
      }
    }
  }
  return decisions;
}

export async function assignClusters(dryRun: boolean): Promise<ClusterDecision[]> {
  // band gate: NC content (sports, horoscope, TV listings) chains into event
  // mega-clusters (41-article Copa cluster, 2026-07-16) and has no spectrum
  // story to tell — clusters carry blindspot math, which is banded-only.
  // Unclassified articles wait too: classify precedes embed in the cycle, so
  // this only defers clustering past a classify failure, never blocks it.
  const candidates = await db.execute(sql`
    select a.id, a.title, coalesce(a.published_at, a.fetched_at) as ts
    from articles a
    where a.embedding is not null
      and a.status = 'published'
      and a.duplicate_of is null
      and a.cluster_id is null
      and a.band is not null
      and a.band <> 'NC'
      and a.fetched_at > now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'
    order by coalesce(a.published_at, a.fetched_at) asc
  `);

  return clusterCandidates(toCandidates(candidates.rows), { dryRun, timeRef: "wall" });
}

function toCandidates(rows: unknown[]): Candidate[] {
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    ts: r.ts ? new Date(String(r.ts)) : null,
  }));
}

/**
 * Retroactive clustering for a closed date range (spec §3.4, recovery path).
 *
 * Why this exists: `assignClusters` only ever looks at the last WINDOW_HOURS,
 * so an article that gets its band AFTER that window — the normal outcome when
 * classification was down, as during the Novita balance outage of 2026-07-20 —
 * is banded but permanently unclustered, leaving a hole in the event history.
 * This replays the same greedy decisions in article time to fill it.
 *
 * It is deliberately NOT wired into the worker tick: it is a manual recovery
 * tool (scripts/backfill-clusters.ts), and clusters it creates are backdated,
 * so they never surface in home.ts's 24h "breaking" pool.
 */
export async function backfillClusters(opts: {
  from: Date;
  to: Date;
  dryRun: boolean;
}): Promise<{ decisions: ClusterDecision[]; confirm: Awaited<ReturnType<typeof confirmReviewPairs>> }> {
  const candidates = await db.execute(sql`
    select a.id, a.title, coalesce(a.published_at, a.fetched_at) as ts
    from articles a
    where a.embedding is not null
      and a.status = 'published'
      and a.duplicate_of is null
      and a.cluster_id is null
      and a.band is not null
      and a.band <> 'NC'
      and coalesce(a.published_at, a.fetched_at) >= ${opts.from.toISOString()}
      and coalesce(a.published_at, a.fetched_at) < ${opts.to.toISOString()}
    order by coalesce(a.published_at, a.fetched_at) asc
  `);

  const decisions = await clusterCandidates(toCandidates(candidates.rows), {
    dryRun: opts.dryRun,
    timeRef: "article",
  });
  // The live cycle can never reach these rows (they are outside its 72h
  // window), so the backfill is the ONLY path that resolves their review band.
  const confirm = await confirmReviewPairs(decisions, opts.dryRun);
  return { decisions, confirm };
}

/**
 * Resolves the [CLUSTER_REVIEW, CLUSTER_ATTACH) band (spec §3.4.4).
 *
 * Embedding similarity alone cannot separate "same event" from "same topic" in
 * this range, so before this existed the band was a black hole: the article got
 * no cluster AND no new cluster, so it stayed invisible to every event-level
 * view and was re-evaluated to the same non-answer every cycle. As of
 * 2026-07-21 that was 4,542 banded articles, ~94% of all retry candidates.
 *
 * The model gets exactly one bounded question — "same real event, yes or no?"
 * — about the candidate and the CONCRETE neighbour that produced the score.
 * Conservative by construction:
 *   - attach ONLY on an explicit yes at >= CLUSTER_CONFIRM_MIN_CONF;
 *   - anything else (no, low confidence, unparseable) falls through to a NEW
 *     cluster, which is exactly what a sub-review score already does — so a
 *     failed confirm degrades to today's below-threshold behaviour and never
 *     invents a merge;
 *   - a provider outage stops the pass with the articles untouched, so they
 *     are simply reconsidered next cycle.
 */
export async function confirmReviewPairs(
  decisions: ClusterDecision[],
  dryRun: boolean,
): Promise<{ attached: number; separated: number; unresolved: number; usd: number }> {
  const pending = decisions.filter((d) => d.action === "review" && d.nearestId && d.clusterId);
  const result = { attached: 0, separated: 0, unresolved: 0, usd: 0 };
  if (!CLUSTER_CONFIRM_ENABLED || !novitaEnabled() || pending.length === 0) return result;

  const spend = await getSpendToday();
  if (!spend.underCeiling) return result;

  const usage = { input_tokens: 0, output_tokens: 0 };
  const [batch] = dryRun
    ? [null]
    : await db
        .insert(tables.llmBatches)
        .values({
          providerBatchId: `novita-confirm-${Date.now()}`,
          modelId: `novita:${NOVITA_MODEL_ID} (cluster-confirm)`,
          rubricVersion: 0,
          articleCount: pending.length,
        })
        .returning();

  for (const d of pending) {
    const pair = await db.execute(sql`
      select a.id, a.title, a.excerpt, oa.name as outlet,
             b.id as b_id, b.title as b_title, b.excerpt as b_excerpt, ob.name as b_outlet
      from articles a
      join outlets oa on oa.id = a.outlet_id
      join articles b on b.id = ${d.nearestId}
      join outlets ob on ob.id = b.outlet_id
      where a.id = ${d.articleId}
    `);
    const p = pair.rows[0] as Record<string, unknown> | undefined;
    if (!p) {
      result.unresolved++;
      continue;
    }

    let verdict: { sameEvent: boolean; confidence: number } | null = null;
    try {
      const { raw, usage: u } = await novitaChat(
        "Você compara notícias brasileiras. Responda APENAS com JSON.",
        clusterConfirmPrompt(
          { title: String(p.title), excerpt: String(p.excerpt), outlet: String(p.outlet) },
          { title: String(p.b_title), excerpt: String(p.b_excerpt), outlet: String(p.b_outlet) },
        ),
      );
      usage.input_tokens += u.input_tokens;
      usage.output_tokens += u.output_tokens;
      verdict = parseClusterConfirm(raw);
    } catch (err) {
      if (err instanceof ProviderError && err.isOutage) break; // untouched; retry next cycle
      verdict = null;
    }

    const attach = verdict?.sameEvent === true && verdict.confidence >= CLUSTER_CONFIRM_MIN_CONF;
    if (attach) result.attached++;
    else if (verdict) result.separated++;
    else result.unresolved++;

    if (dryRun) continue;
    if (attach) {
      await db
        .update(tables.articles)
        .set({ clusterId: d.clusterId })
        .where(eq(tables.articles.id, d.articleId));
    } else {
      // Same fate as a sub-review score: its own cluster, never a silent merge.
      const [cluster] = await db
        .insert(tables.clusters)
        .values({ title: d.title, ...(d.ts ? { createdAt: d.ts } : {}) })
        .returning({ id: tables.clusters.id });
      await db
        .update(tables.articles)
        .set({ clusterId: cluster.id })
        .where(eq(tables.articles.id, d.articleId));
    }
  }

  result.usd = estimateNovitaUsd(usage);
  if (batch) {
    await db
      .update(tables.llmBatches)
      .set({
        status: "ended",
        endedAt: new Date(),
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        estimatedUsd: result.usd,
      })
      .where(eq(tables.llmBatches.id, batch.id));
  }
  return result;
}

/** The full stage 5 cycle: dedup first (spec §3.4.2), then clustering. */
export async function runClusterCycle(dryRun: boolean) {
  const dups = await markDuplicates(dryRun);
  const clusters = await assignClusters(dryRun);
  const confirm = await confirmReviewPairs(clusters, dryRun);
  return { dups, clusters, confirm };
}
