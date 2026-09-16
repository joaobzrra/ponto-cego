import { and, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import type { Band } from "@/db/schema";
import type { ClassificationResult } from "./llm";
import { cardEligible, cardTitle, clusterHasFace } from "./card-eligibility";
import { providerFromModelId } from "./classifier-provider";
import { rankBlindspots, type Blindspot, type BlindspotCandidate } from "./blindspots";

type Article = typeof tables.articles.$inferSelect;

/**
 * The per-article user prompt. The rubric is the (cached) system prompt; this
 * carries only the article. feed_scope is provided as context — the rubric's
 * NC gate applies to every article in the same single call (Addendum 01 §A2).
 */
export function buildArticlePrompt(
  article: Pick<Article, "title" | "excerpt" | "canonicalUrl" | "feedScope">,
  fullText: string | null,
): { prompt: string; lowConfidence: boolean } {
  const lines = [
    `Título: ${article.title}`,
    `URL: ${article.canonicalUrl}`,
    `Origem: feed ${article.feedScope === "politica" ? "de seção política" : "geral"}`,
  ];
  if (fullText) {
    lines.push("", "Texto integral (obtido transitoriamente, não armazenado):", fullText);
  } else {
    lines.push(
      "",
      "ATENÇÃO: texto integral indisponível — classifique apenas por título e excerto (entrada de baixa confiança; reduza a confiança de acordo).",
      `Excerto: ${article.excerpt}`,
    );
  }
  return { prompt: lines.join("\n"), lowConfidence: !fullText };
}

export async function applyClassification(
  articleId: number,
  result: ClassificationResult,
  meta: { rubricVersion: number; modelId: string; batchId: number },
): Promise<void> {
  const activatedAt = new Date();
  const provider = providerFromModelId(meta.modelId);
  await db.transaction(async (tx) => {
    await tx.insert(tables.classificationObservations).values({
      articleId,
      batchId: meta.batchId,
      provider,
      modelId: meta.modelId,
      rubricVersion: meta.rubricVersion,
      promptVersion: process.env.CLASSIFY_PROMPT_VERSION ?? "v1",
      band: result.band,
      confidence: result.confidence,
      keywords: result.keywords,
      category: result.category,
      reason: result.reason,
      activatedAt,
    });
    await tx
      .update(tables.articles)
      .set({
        band: result.band,
        bandConfidence: result.confidence,
        keywords: result.keywords,
        category: result.category,
        classifyReason: result.reason,
        rubricVersion: meta.rubricVersion,
        modelId: meta.modelId,
        classifiedAt: activatedAt,
        classifyStatus: "classified",
        classifyBatchId: meta.batchId,
      })
      .where(eq(tables.articles.id, articleId));
  });
}

/** Atomically promotes a prior successful observation to the public projection. */
export async function activateClassificationObservation(observationId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [observation] = await tx
      .select()
      .from(tables.classificationObservations)
      .where(eq(tables.classificationObservations.id, observationId))
      .limit(1);
    if (!observation || observation.status !== "succeeded" || !observation.band) {
      throw new Error("Classification observation is not activatable");
    }
    const activatedAt = new Date();
    await tx
      .update(tables.classificationObservations)
      .set({ activatedAt })
      .where(eq(tables.classificationObservations.id, observationId));
    await tx
      .update(tables.articles)
      .set({
        band: observation.band,
        bandConfidence: observation.confidence,
        keywords: observation.keywords,
        category: observation.category,
        classifyReason: observation.reason,
        rubricVersion: observation.rubricVersion,
        modelId: observation.modelId,
        classifiedAt: activatedAt,
        classifyStatus: "classified",
        classifyBatchId: observation.batchId,
      })
      .where(eq(tables.articles.id, observation.articleId));
  });
}

/** Distribution of bands for one outlet over a trailing window. */
export type OutletAggregate = {
  outletId: number;
  /** Counts per political band — NC deliberately absent (exclusion rule 1). */
  bandCounts: Partial<Record<Exclude<Band, "NC">, number>>;
  /** The displayed denominator: "média dos últimos 90 dias (N artigos políticos)". */
  politicalArticles: number;
  ncArticles: number;
  unclassified: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Outlet 90-day rolling aggregate (spec §3.1) with the NC exclusion rules of
 * Addendum 01 §A2: NC articles are excluded from ALL spectrum math; the
 * denominator shown to users counts classifiable articles only. This is the
 * single primitive later stages (cluster bars, blindspot) must reuse so the
 * exclusion holds everywhere.
 */
export async function outletAggregate(outletId: number, days = 90): Promise<OutletAggregate> {
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await db
    .select({ band: tables.articles.band, n: sql<number>`count(*)` })
    .from(tables.articles)
    .where(
      and(
        eq(tables.articles.outletId, outletId),
        eq(tables.articles.status, "published"),
        // Wire-copy dedup (stage 5): syndicated duplicates never count as
        // independent coverage. No-op until dedup runs (column stays null).
        isNull(tables.articles.duplicateOf),
        gte(tables.articles.fetchedAt, since),
      ),
    )
    .groupBy(tables.articles.band);

  const agg: OutletAggregate = {
    outletId,
    bandCounts: {},
    politicalArticles: 0,
    ncArticles: 0,
    unclassified: 0,
  };
  for (const { band, n } of rows) {
    const count = Number(n);
    if (band === null) agg.unclassified += count;
    else if (band === "NC") agg.ncArticles += count;
    else {
      agg.bandCounts[band as Exclude<Band, "NC">] = count;
      agg.politicalArticles += count;
    }
  }
  return agg;
}

/**
 * The same 90-day aggregate for MANY outlets in one grouped query. The event
 * thread needs one per distinct outlet in the cluster (20+ on a busy story);
 * fanning outletAggregate out per outlet would issue that many concurrent
 * queries against a 10-connection pool. Exclusion rules identical to
 * outletAggregate — this is a batching of the primitive, not a second one.
 */
export async function outletAggregates(
  outletIds: number[],
  days = 90,
): Promise<Map<number, OutletAggregate>> {
  const map = new Map<number, OutletAggregate>();
  if (outletIds.length === 0) return map;
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await db
    .select({
      outletId: tables.articles.outletId,
      band: tables.articles.band,
      n: sql<number>`count(*)`,
    })
    .from(tables.articles)
    .where(
      and(
        inArray(tables.articles.outletId, outletIds),
        eq(tables.articles.status, "published"),
        isNull(tables.articles.duplicateOf),
        gte(tables.articles.fetchedAt, since),
      ),
    )
    .groupBy(tables.articles.outletId, tables.articles.band);

  for (const id of outletIds) {
    map.set(id, { outletId: id, bandCounts: {}, politicalArticles: 0, ncArticles: 0, unclassified: 0 });
  }
  for (const { outletId, band, n } of rows) {
    const agg = map.get(outletId);
    if (!agg) continue;
    const count = Number(n);
    if (band === null) agg.unclassified += count;
    else if (band === "NC") agg.ncArticles += count;
    else {
      agg.bandCounts[band as Exclude<Band, "NC">] = count;
      agg.politicalArticles += count;
    }
  }
  return map;
}

/** Per-cluster spectrum aggregate (stage 5) — the same NC-exclusion shape as
 * outletAggregate, plus distinct-outlet counts per side (blindspot math works
 * on OUTLETS covering, not article volume). */
export type ClusterAggregate = {
  clusterId: number;
  bandCounts: Partial<Record<Exclude<Band, "NC">, number>>;
  outletsBySide: { esquerda: number; centro: number; direita: number };
  totalOutlets: number;
  politicalArticles: number;
};

export async function clusterAggregate(clusterId: number): Promise<ClusterAggregate> {
  const rows = await db
    .select({
      band: tables.articles.band,
      n: sql<number>`count(*)`,
      outlets: sql<number>`count(distinct ${tables.articles.outletId})`,
    })
    .from(tables.articles)
    .where(
      and(
        eq(tables.articles.clusterId, clusterId),
        eq(tables.articles.status, "published"),
        isNull(tables.articles.duplicateOf),
      ),
    )
    .groupBy(tables.articles.band);

  const agg: ClusterAggregate = {
    clusterId,
    bandCounts: {},
    outletsBySide: { esquerda: 0, centro: 0, direita: 0 },
    totalOutlets: 0,
    politicalArticles: 0,
  };
  for (const { band, n, outlets } of rows) {
    if (band === null || band === "NC") continue;
    const count = Number(n);
    agg.bandCounts[band as Exclude<Band, "NC">] = count;
    agg.politicalArticles += count;
    const side = band.startsWith("E") ? "esquerda" : band.startsWith("D") ? "direita" : "centro";
    agg.outletsBySide[side] += Number(outlets);
  }
  agg.totalOutlets =
    agg.outletsBySide.esquerda + agg.outletsBySide.centro + agg.outletsBySide.direita;
  return agg;
}

export type SubnoticiadosOptions = {
  days?: number;
  minOutlets?: number;
  maxShare?: number;
  minAgeHours?: number;
  onePerSubject?: boolean;
};

/**
 * Blindspot candidates (spec 2026-09-03 §3): active clusters with a member
 * article inside `days`, ≥ minOutlets distinct banded outlets, and a first
 * article older than minAgeHours (a story one-sided after 12h is usually
 * lag; silence needs a day to be proven). Per cluster the query also returns
 * the subject (most frequent keyword across banded articles, outlet names
 * excluded), every keyword (for the topic sections), the newest thumbnail
 * and the first/last article times. Ranking and the one-per-subject rule
 * live in lib/blindspots.ts so they can be unit-tested without a DB.
 */
export async function subnoticiados(opts: SubnoticiadosOptions = {}): Promise<Blindspot[]> {
  const days = opts.days ?? 7;
  const minOutlets = opts.minOutlets ?? 4;
  const minAgeHours = opts.minAgeHours ?? 24;
  const result = await db.execute(sql`
    with pool as (
      select c.id, c.title,
             count(distinct a.outlet_id) filter (where a.band in ('E3','E2','E1'))::int as e_out,
             count(distinct a.outlet_id) filter (where a.band = 'C')::int as c_out,
             count(distinct a.outlet_id) filter (where a.band in ('D1','D2','D3'))::int as d_out,
             count(a.id) filter (where a.band is not null and a.band <> 'NC')::int as political,
             min(coalesce(a.published_at, a.fetched_at)) as first_at,
             max(coalesce(a.published_at, a.fetched_at)) as last_at
      from clusters c
      join articles a on a.cluster_id = c.id
        and a.status = 'published'
        and a.duplicate_of is null
      where c.status = 'active'
      group by c.id, c.title
      having count(distinct a.outlet_id) filter (where a.band is not null and a.band <> 'NC')
               >= ${minOutlets}
         and max(coalesce(a.published_at, a.fetched_at))
               >= now() - interval '${sql.raw(String(days))} days'
         and min(coalesce(a.published_at, a.fetched_at))
               <= now() - interval '${sql.raw(String(minAgeHours))} hours'
    )
    select p.*,
      (select lower(kw)
         from articles a, jsonb_array_elements_text(a.keywords) as kw
        where a.cluster_id = p.id and a.status = 'published' and a.duplicate_of is null
          and a.band is not null and a.band <> 'NC' and length(kw) > 2
          and not exists (select 1 from outlets o where lower(o.name) = lower(kw))
        group by lower(kw)
        order by count(*) desc, lower(kw)
        limit 1) as subject,
      coalesce((select array_agg(distinct lower(kw))
         from articles a, jsonb_array_elements_text(a.keywords) as kw
        where a.cluster_id = p.id and a.status = 'published' and a.duplicate_of is null
          and a.band is not null and a.band <> 'NC'), '{}') as keywords,
      (select a.thumbnail_path
         from articles a
        where a.cluster_id = p.id and a.status = 'published' and a.duplicate_of is null
          and a.thumbnail_path is not null
          and ${cardEligible("a")}
        order by coalesce(a.published_at, a.fetched_at) desc
        limit 1) as thumbnail_path,
      ${cardTitle("p")} as card_title
    from pool p
    where ${clusterHasFace("p")}
  `);
  const rows: BlindspotCandidate[] = (result.rows as Array<Record<string, unknown>>).map((r) => ({
    clusterId: Number(r.id),
    // A flagged outlet must not supply the card's headline either. clusters.title
    // is the SEED article's title and 430 clusters were seeded by Sputnik, so the
    // card resolves its own; `where clusterHasFace` guarantees this is non-null.
    title: String(r.card_title ?? r.title),
    sides: { esquerda: Number(r.e_out), centro: Number(r.c_out), direita: Number(r.d_out) },
    politicalArticles: Number(r.political),
    subject: r.subject === null || r.subject === undefined ? null : String(r.subject),
    keywords: Array.isArray(r.keywords) ? (r.keywords as string[]) : [],
    thumbnailPath: r.thumbnail_path === null || r.thumbnail_path === undefined ? null : String(r.thumbnail_path),
    // node-postgres already parses timestamptz into a Date; String()-ing one
    // and re-parsing loses the timezone on some locales. Keep the Date.
    firstAt: r.first_at instanceof Date ? r.first_at : new Date(String(r.first_at)),
    lastAt: r.last_at instanceof Date ? r.last_at : new Date(String(r.last_at)),
  }));
  return rankBlindspots(rows, { maxShare: opts.maxShare ?? 0.2, onePerSubject: opts.onePerSubject ?? true });
}

/** % NC over trailing 7 days per outlet (Addendum 01 §A2 admin visibility). */
export async function ncRates7d(): Promise<Map<number, { nc: number; classified: number }>> {
  const since = new Date(Date.now() - 7 * DAY_MS);
  const rows = await db
    .select({
      outletId: tables.articles.outletId,
      nc: sql<number>`count(*) filter (where ${tables.articles.band} = 'NC')`,
      classified: sql<number>`count(*)`,
    })
    .from(tables.articles)
    .where(
      and(
        isNotNull(tables.articles.band),
        gte(tables.articles.fetchedAt, since),
        ne(tables.articles.status, "unpublished"),
      ),
    )
    .groupBy(tables.articles.outletId);
  return new Map(rows.map((r) => [r.outletId, { nc: Number(r.nc), classified: Number(r.classified) }]));
}
