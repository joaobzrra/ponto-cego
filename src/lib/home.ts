import { sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { rankBlindspots, type Blindspot } from "./blindspots";
import { cardEligible } from "./card-eligibility";
import { consumeBlindspots } from "./consume-blindspots";
import { BRIEFING_ENABLED, BRIEFING_LIMIT, briefingLinesFor, readingMinutes } from "./briefing";
import { subnoticiados } from "./classification";
import { getApprovedDestaque, type ApprovedDestaque } from "./destaque";
import { interimHero, type InterimHero } from "./interim";
import {
  categoryClusters,
  categoryStats,
  keywordLead,
  rotatingCategoryOrder,
  type CategorySection,
  type ClusterCard,
  type TopicSection,
} from "./topics";

/*
 * Front-page data (Final-Wireframe, 2026-07-18) — every section computed
 * here so the DEDUPE CASCADE lives in one place: hero → tópicos em alta →
 * resumo do dia → blindspots (featured → weekly → pair) → topic sections →
 * category sections → bottom side keywords. Each section skips clusters/
 * keywords/articles already shown above it; on a mega-story day the #1
 * subject appears once, in the hero, and the page keeps breadth.
 *
 * Windows are 24h (one news cycle, matching the cluster max lifetime). The
 * keyword sections widen to 48h when 24h comes up short — keywords come from
 * the classifier, so a tight window goes blank whenever the spend cap pauses
 * classification. Cluster sections never widen: clusters age off at 24h by
 * product rule (CLUSTER_MAX_AGE_HOURS), and the hero falls back to the
 * keyword-driven interimHero instead.
 */

export type Side = "esquerda" | "centro" | "direita";
export type SideOutlets = Record<Side, number>;

export const SIDE_BANDS: Record<Side, string[]> = {
  esquerda: ["E3", "E2", "E1"],
  centro: ["C"],
  direita: ["D1", "D2", "D3"],
};

/**
 * Keywords too generic to be a "topic" — category words the classifier emits
 * alongside the real subjects. Exact-match, lowercase. Editorial knob:
 * extend as noise shows up in production.
 */
const STOPLIST = new Set([
  "brasil",
  "governo",
  "política",
  "politica",
  "país",
  "pais",
  "notícias",
  "noticias",
  "hoje",
  "mundo",
  "nacional",
  "internacional",
  "brasileiro",
  "brasileira",
]);

const ALTA_LIMIT = 4;
const CHIP_LIMIT = 8;
const WEEKLY_LIMIT = 4;
const TOPIC_LIMIT = 3;
const TOPIC_CARDS = 3;
const CATEGORY_MORE = 3;
/** Ranking window inside the 24h cluster pool: current heat, not lifetime size. */
const HEAT_HOURS = 12;

export type ClusterHero = {
  clusterId: number;
  title: string;
  arts: number;
  outlets: number;
  sides: SideOutlets;
  thumbnailPath: string | null;
};

export type Hero =
  | { kind: "approved"; d: ApprovedDestaque }
  | { kind: "cluster"; c: ClusterHero }
  | { kind: "interim"; h: InterimHero };

export type AltaCard = {
  clusterId: number;
  title: string;
  arts: number;
  /** Distinct banded outlets covering the cluster (what the meter counts). */
  outlets: number;
  sides: SideOutlets;
};

export type BottomItem = {
  kw: string;
  arts: number;
  outlets: number;
  hours: number;
  sides: SideOutlets;
  article: { id: number; title: string; thumbnailPath: string | null };
};

export type BottomColumn = { side: Side; item: BottomItem | null };

/** Search-strip chip: a trending keyword and its distinct-outlet count. */
export type Chip = { kw: string; outlets: number };

/** One Resumo do dia entry: a cluster head plus its cached machine line. */
export type BriefItem = ClusterHero & { line: string | null };

export type Briefing = { items: BriefItem[]; arts: number; minutes: number };

export type HomeData = {
  chips: Chip[];
  bottom: BottomColumn[];
  hero: Hero | null;
  alta: AltaCard[];
  /** null when BRIEFING_ENABLED=0 or no cluster is left for it. */
  briefing: Briefing | null;
  featured: Blindspot | null;
  weekly: Blindspot[];
  pair: { direita: Blindspot | null; esquerda: Blindspot | null };
  topics: TopicSection[];
  categories: CategorySection[];
};

export type ClusterHead = {
  id: number;
  title: string;
  arts: number;
  heat: number;
  outlets: number;
};

/**
 * One pool query feeds both the hero (coverage rank) and the alta cards
 * (heat rank): live clusters with real multi-outlet coverage. Banded-outlet
 * filter mirrors clusterAggregate's NC exclusion.
 */
export async function clusterPool(): Promise<ClusterHead[]> {
  const result = await db.execute(sql`
    select c.id, c.title,
           count(a.id)::int as arts,
           count(a.id) filter (where coalesce(a.published_at, a.fetched_at)
                                 >= now() - interval '${sql.raw(String(HEAT_HOURS))} hours')::int as heat,
           count(distinct a.outlet_id) filter (where a.band is not null and a.band <> 'NC')::int as outlets
    from clusters c
    join articles a on a.cluster_id = c.id
      and a.status = 'published'
      and a.duplicate_of is null
    where c.status = 'active'
      and c.created_at >= now() - interval '24 hours'
    group by c.id, c.title
    having count(distinct a.outlet_id) filter (where a.band is not null and a.band <> 'NC') >= 2
  `);
  return (result.rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    arts: Number(r.arts),
    heat: Number(r.heat),
    outlets: Number(r.outlets),
  }));
}

/** Distinct outlets per side for a set of clusters, one grouped query. */
async function clusterSides(ids: number[]): Promise<Map<number, SideOutlets>> {
  const out = new Map<number, SideOutlets>();
  if (ids.length === 0) return out;
  const result = await db.execute(sql`
    select a.cluster_id, a.band, count(distinct a.outlet_id)::int as outlets
    from articles a
    where a.cluster_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      and a.status = 'published'
      and a.duplicate_of is null
      and a.band is not null and a.band <> 'NC'
    group by a.cluster_id, a.band
  `);
  for (const r of result.rows as Array<{ cluster_id: number; band: string; outlets: number }>) {
    const id = Number(r.cluster_id);
    const sides = out.get(id) ?? { esquerda: 0, centro: 0, direita: 0 };
    const side: Side = r.band.startsWith("E")
      ? "esquerda"
      : r.band.startsWith("D")
        ? "direita"
        : "centro";
    sides[side] += Number(r.outlets);
    out.set(id, sides);
  }
  return out;
}

/**
 * Outlets tag themselves as keywords when an article references their own
 * work (Brasil Paralelo did it in 7/65 articles on 2026-09-02, and the
 * over-representation pick promptly crowned it "what the right talks
 * about"). An outlet's name is never a subject.
 */
export const notAnOutletName = sql`not exists (
  select 1 from outlets o where lower(o.name) = lower(kw)
)`;

const kwMatch = (kw: string) => sql`exists (
  select 1 from jsonb_array_elements_text(a.keywords) as k where lower(k) = ${kw}
)`;

type KwCandidate = {
  kw: string;
  arts: number;
  outlets: number;
  political: number;
  sides: SideOutlets;
};

/** Baseline span for keyword velocity (days). */
const VELOCITY_BASELINE_DAYS = 7;

/**
 * Trending keywords with per-side distinct-outlet counts, ranked by VELOCITY:
 * political volume inside the window divided by the keyword's average volume
 * per window over the last VELOCITY_BASELINE_DAYS. "stf" at 300 a day every
 * day scores ~1; a subject that went from 5 to 60 scores ~7 (r/brasil launch
 * feedback 2026-09-02: raw frequency showed the same generic names daily).
 * The baseline floor of 3 keeps tiny keywords from scoring infinity; when no
 * history exists yet (right after a reclassification) every score collapses
 * to the same constant and the order falls back to political volume.
 * Only keywords with some banded coverage qualify — every item carries a
 * spectrum meter.
 */
export async function trendingKeywords(hours: number): Promise<KwCandidate[]> {
  const windowsInBaseline = (VELOCITY_BASELINE_DAYS * 24) / hours;
  const inWindow = sql.raw(`a.fetched_at > now() - interval '${hours} hours'`);
  const result = await db.execute(sql`
    with kw as (
      select lower(kw) as kw,
             count(*) filter (where ${inWindow})::int as arts,
             count(distinct a.outlet_id) filter (where ${inWindow})::int as outlets,
             count(*) filter (where ${inWindow} and a.band is not null and a.band <> 'NC')::int as political,
             count(*) filter (where a.band is not null and a.band <> 'NC')::int as baseline,
             count(distinct a.outlet_id) filter (where ${inWindow} and a.band in ('E3','E2','E1'))::int as e_out,
             count(distinct a.outlet_id) filter (where ${inWindow} and a.band = 'C')::int as c_out,
             count(distinct a.outlet_id) filter (where ${inWindow} and a.band in ('D1','D2','D3'))::int as d_out
      from articles a, jsonb_array_elements_text(a.keywords) as kw
      where a.fetched_at > now() - interval '${sql.raw(String(VELOCITY_BASELINE_DAYS))} days'
        and a.status = 'published'
        and a.duplicate_of is null
        and length(kw) > 2
        and ${notAnOutletName}
      group by lower(kw)
    )
    select kw, arts, outlets, political, e_out, c_out, d_out,
           political / greatest(baseline::numeric / ${windowsInBaseline}, 3) as velocity
    from kw
    where political >= 3
    order by velocity desc, political desc, arts desc
    limit 15
  `);
  return (result.rows as Array<Record<string, unknown>>)
    .map((r) => ({
      kw: String(r.kw),
      arts: Number(r.arts),
      outlets: Number(r.outlets),
      political: Number(r.political),
      sides: {
        esquerda: Number(r.e_out),
        centro: Number(r.c_out),
        direita: Number(r.d_out),
      },
    }))
    .filter((c) => !STOPLIST.has(c.kw));
}

/**
 * Keywords ONE side OVER-covers (the sides band's per-side pick): the
 * keyword's share of that side's political articles divided by its share of
 * everyone's. Raw frequency handed all three sides the same generic names
 * ("lula", "stf"); over-representation surfaces what a side talks about more
 * than the others do, weighted by ln(volume) so a broad subject beats a
 * six-article ratio fluke. Floor of 5 articles AND 2 distinct outlets on
 * the side: one outlet is not a side (2026-09-02: two Brasil Paralelo
 * pieces became "o que a direita noticia").
 */
async function sideKeywords(side: Side, hours: number): Promise<Array<{ kw: string; n: number }>> {
  const bands = SIDE_BANDS[side];
  const result = await db.execute(sql`
    with kw as (
      select lower(kw) as kw,
             count(*) filter (where a.band in (${sql.join(bands.map((b) => sql`${b}`), sql`, `)}))::int as n,
             count(distinct a.outlet_id) filter (where a.band in (${sql.join(bands.map((b) => sql`${b}`), sql`, `)}))::int as n_outlets,
             count(*)::int as pol
      from articles a, jsonb_array_elements_text(a.keywords) as kw
      where a.fetched_at > now() - interval '${sql.raw(String(hours))} hours'
        and a.status = 'published'
        and a.duplicate_of is null
        and a.band is not null and a.band <> 'NC'
        and length(kw) > 2
        and ${notAnOutletName}
      group by lower(kw)
    )
    select kw, n,
           (n::numeric / nullif(sum(n) over (), 0))
             / nullif(pol::numeric / nullif(sum(pol) over (), 0), 0)
             * ln(n + 1) as score
    from kw
    where n >= 5 and n_outlets >= 2
    order by score desc nulls last, n desc
    limit 10
  `);
  return (result.rows as Array<{ kw: string; n: number }>)
    .map((r) => ({ kw: String(r.kw), n: Number(r.n) }))
    .filter((r) => !STOPLIST.has(r.kw));
}

/** Full-spectrum stats for one keyword (bottom cards' meter + article count). */
async function kwSpectrum(
  kw: string,
  hours: number,
): Promise<{ arts: number; outlets: number; sides: SideOutlets }> {
  const result = await db.execute(sql`
    select count(*)::int as arts,
           count(distinct a.outlet_id)::int as outlets,
           count(distinct a.outlet_id) filter (where a.band in ('E3','E2','E1'))::int as e_out,
           count(distinct a.outlet_id) filter (where a.band = 'C')::int as c_out,
           count(distinct a.outlet_id) filter (where a.band in ('D1','D2','D3'))::int as d_out
    from articles a
    where a.fetched_at > now() - interval '${sql.raw(String(hours))} hours'
      and a.status = 'published'
      and a.duplicate_of is null
      and ${kwMatch(kw)}
  `);
  const r = result.rows[0] as Record<string, unknown>;
  return {
    arts: Number(r.arts),
    outlets: Number(r.outlets),
    sides: {
      esquerda: Number(r.e_out),
      centro: Number(r.c_out),
      direita: Number(r.d_out),
    },
  };
}

/** Latest article from one side on a keyword, preferring illustrated ones. */
async function latestSideArticle(
  side: Side,
  kw: string,
  hours: number,
  usedArticleIds: Set<number>,
): Promise<{ id: number; title: string; thumbnailPath: string | null } | null> {
  const bands = SIDE_BANDS[side];
  const result = await db.execute(sql`
    select a.id, a.title, a.thumbnail_path
    from articles a
    where a.fetched_at > now() - interval '${sql.raw(String(hours))} hours'
      and a.status = 'published'
      and a.duplicate_of is null
      and a.band in (${sql.join(bands.map((b) => sql`${b}`), sql`, `)})
      and ${kwMatch(kw)}
      and ${cardEligible("a")}
    order by (a.thumbnail_path is not null) desc,
             coalesce(a.published_at, a.fetched_at) desc
    limit 3
  `);
  for (const r of result.rows as Array<{ id: number; title: string; thumbnail_path: string | null }>) {
    if (!usedArticleIds.has(Number(r.id))) {
      return { id: Number(r.id), title: r.title, thumbnailPath: r.thumbnail_path };
    }
  }
  return null;
}

/** Best illustrated member of a cluster — the hero image. */
async function clusterThumb(
  clusterId: number,
): Promise<{ articleId: number; thumbnailPath: string | null } | null> {
  const result = await db.execute(sql`
    select a.id, a.thumbnail_path
    from articles a
    where a.cluster_id = ${clusterId}
      and a.status = 'published'
      and a.duplicate_of is null
      and ${cardEligible("a")}
    order by (a.band is not null and a.band <> 'NC') desc,
             (a.thumbnail_path is not null) desc,
             coalesce(a.published_at, a.fetched_at) desc
    limit 1
  `);
  const r = result.rows[0] as { id: number; thumbnail_path: string | null } | undefined;
  return r ? { articleId: Number(r.id), thumbnailPath: r.thumbnail_path } : null;
}

type HeadSelection = {
  /** The cluster promoted to the hero, or null when an approved destaque (or the interim hero) holds the slot. */
  heroCluster: ClusterHead | null;
  altaHeads: ClusterHead[];
  /** The clusters the Resumo do dia would show right now — hero and alta removed. */
  briefHeads: ClusterHead[];
  /** Cluster ids consumed by the hero and the alta cards. Brief heads are NOT in it. */
  used: Set<number>;
};

/**
 * The page's cluster selection down to the Resumo do dia, in one pure place.
 * `homeData()` and `briefingHeads()` both go through it, so the worker can
 * never pay for a cluster the page would not show (fix wave item A): the
 * briefing pool is what is left of `clusterPool()` after the hero and the
 * ALTA_LIMIT Tópicos em Alta cards, ranked the same way the page ranks it.
 */
function selectHeads(
  pool: ClusterHead[],
  sidesOf: (id: number) => SideOutlets,
  approved: ApprovedDestaque | null,
): HeadSelection {
  const used = new Set<number>();

  // ── Hero ── approved destaque wins; else biggest 24h coverage.
  let heroCluster: ClusterHead | null = null;
  if (approved) {
    if (approved.clusterId !== null) used.add(approved.clusterId);
  } else {
    const byCoverage = [...pool].sort((a, b) => b.outlets - a.outlets || b.arts - a.arts);
    const top = byCoverage[0];
    if (top) {
      heroCluster = top;
      used.add(top.id);
    }
  }

  // ── Tópicos em Alta ── heat rank over the same pool, hero excluded. The
  // LEAD card must show all three sides (designer rule 2026-07-18: a
  // one-color meter at the top of the column breaks the page's promise), so
  // the first full-spectrum cluster in heat order is promoted to slot 1.
  const byHeat = pool
    .filter((c) => !used.has(c.id))
    .sort((a, b) => b.heat - a.heat || b.arts - a.arts);
  const fullSpectrum = (id: number) => {
    const s = sidesOf(id);
    return s.esquerda > 0 && s.centro > 0 && s.direita > 0;
  };
  const leadIdx = byHeat.findIndex((c) => fullSpectrum(c.id));
  const ordered =
    leadIdx > 0 ? [byHeat[leadIdx], ...byHeat.filter((_, i) => i !== leadIdx)] : byHeat;
  const altaHeads = ordered.slice(0, ALTA_LIMIT);
  for (const c of altaHeads) used.add(c.id);

  // ── Resumo do dia ── most-covered 24h clusters not already on the page.
  // Deliberately NOT added to `used`: with BRIEFING_ENABLED=0 the page does
  // not render them and the blindspot walk is free to take them.
  const briefHeads = pool
    .filter((c) => !used.has(c.id))
    .sort((a, b) => b.outlets - a.outlets || b.arts - a.arts || a.id - b.id)
    .slice(0, BRIEFING_LIMIT);

  return { heroCluster, altaHeads, briefHeads, used };
}

/**
 * The exact clusters the Resumo do dia would show on the front page right
 * now. The worker generates lines for these and nothing else (spec §2a,
 * ledger CLM-briefing-machine-text-exempt-from-approval).
 */
export async function briefingHeads(): Promise<ClusterHead[]> {
  const [approved, pool] = await Promise.all([getApprovedDestaque(), clusterPool()]);
  const poolSides = await clusterSides(pool.map((c) => c.id));
  const sidesOf = (id: number) => poolSides.get(id) ?? { esquerda: 0, centro: 0, direita: 0 };
  return selectHeads(pool, sidesOf, approved).briefHeads;
}

export async function homeData(): Promise<HomeData> {
  const usedClusterIds = new Set<number>();
  const usedArticleIds = new Set<number>();
  const usedKeywords = new Set<string>();

  const [approved, pool, rankedAll, chipsRaw, stats] = await Promise.all([
    getApprovedDestaque(),
    clusterPool(),
    subnoticiados({ days: 7, minOutlets: 4, maxShare: 0.2, minAgeHours: 24, onePerSubject: false }),
    trendingKeywords(24),
    categoryStats(),
  ]);
  // The rail and the side pair use the one-per-subject list; the topic
  // sections use the same ranking unfiltered (see consume-blindspots.ts).
  const ranked = rankBlindspots(rankedAll, { maxShare: 0.2, onePerSubject: true });
  const chips: Chip[] = chipsRaw.slice(0, CHIP_LIMIT).map((c) => ({ kw: c.kw, outlets: c.outlets }));
  // One grouped query serves the hero meter AND the alta cards, and lets the
  // alta ordering see side coverage before picking.
  const poolSides = await clusterSides(pool.map((c) => c.id));
  const sidesOf = (id: number) =>
    poolSides.get(id) ?? { esquerda: 0, centro: 0, direita: 0 };

  // Hero + alta + Resumo heads come from the ONE selection the worker shares.
  const selection = selectHeads(pool, sidesOf, approved);
  for (const id of selection.used) usedClusterIds.add(id);

  // ── Hero ── approved destaque wins; else biggest 24h coverage; else interim.
  let hero: Hero | null = null;
  if (approved) {
    hero = { kind: "approved", d: approved };
  } else if (selection.heroCluster) {
    const top = selection.heroCluster;
    const thumb = await clusterThumb(top.id);
    if (thumb) usedArticleIds.add(thumb.articleId);
    hero = {
      kind: "cluster",
      c: {
        clusterId: top.id,
        title: top.title,
        arts: top.arts,
        outlets: top.outlets,
        sides: sidesOf(top.id),
        thumbnailPath: thumb?.thumbnailPath ?? null,
      },
    };
  } else {
    const h = await interimHero();
    if (h) {
      hero = { kind: "interim", h };
      usedKeywords.add(h.kw);
      usedArticleIds.add(h.article.id);
    }
  }

  const alta: AltaCard[] = selection.altaHeads.map((c) => ({
    clusterId: c.id,
    title: c.title,
    arts: c.arts,
    outlets: c.outlets,
    sides: sidesOf(c.id),
  }));

  // ── Resumo do dia ── most-covered 24h clusters not already on the page.
  let briefing: Briefing | null = null;
  if (BRIEFING_ENABLED) {
    const heads = selection.briefHeads;
    if (heads.length > 0) {
      const lines = await briefingLinesFor(heads.map((c) => c.id));
      const items: BriefItem[] = [];
      for (const c of heads) {
        usedClusterIds.add(c.id);
        const thumb = await clusterThumb(c.id);
        if (thumb) usedArticleIds.add(thumb.articleId);
        items.push({
          clusterId: c.id,
          title: c.title,
          arts: c.arts,
          outlets: c.outlets,
          sides: sidesOf(c.id),
          thumbnailPath: thumb?.thumbnailPath ?? null,
          line: lines.get(c.id) ?? null,
        });
      }
      briefing = {
        items,
        arts: items.reduce((n, i) => n + i.arts, 0),
        minutes: readingMinutes(items.map((i) => i.line ?? "")),
      };
    }
  }

  // ── Blindspots ── ONE consumption order over the two ranked lists (spec §3).
  const { featured, weekly, pair, byKeyword } = consumeBlindspots(
    ranked,
    rankedAll,
    chipsRaw.map((c) => c.kw),
    usedClusterIds,
    // One proposal more than the section shows: the keyword's lead may turn
    // out to be one of its own proposed cards, and a later section's lead may
    // claim another, so the spare keeps a section at TOPIC_CARDS instead of
    // silently dropping to two.
    { weekly: WEEKLY_LIMIT, perKeyword: TOPIC_CARDS + 1 },
  );

  // ── Topic sections ── chips in order, until three keywords have a lead +
  // blindspots. The cards are only claimed once the section is certain to
  // render, so a keyword without a lead does not take clusters off the page.
  const topics: TopicSection[] = [];
  for (const c of chipsRaw) {
    if (topics.length >= TOPIC_LIMIT) break;
    const kw = c.kw.toLowerCase();
    const cards = byKeyword.get(kw);
    if (!cards || cards.length === 0) continue;
    const lead = await keywordLead(kw, usedClusterIds);
    if (!lead) continue;
    // The proposals were frozen before any lead was known, so re-check them
    // against BOTH this section's lead and the shared set: an earlier
    // section's lead (or its cards) may have claimed one of them since.
    const blindspots = cards
      .filter((b) => b.clusterId !== lead.clusterId && !usedClusterIds.has(b.clusterId))
      .slice(0, TOPIC_CARDS);
    if (blindspots.length === 0) continue;
    usedClusterIds.add(lead.clusterId);
    for (const b of blindspots) usedClusterIds.add(b.clusterId);
    topics.push({ kw, lead, blindspots });
  }

  // ── Category sections ── two fixed + one rotating thin category.
  const categories: CategorySection[] = [];
  /** Renders one category if it has cards; returns whether it did. */
  const addCategory = async (category: string): Promise<boolean> => {
    const { artsToday, cards } = await categoryClusters(category, usedClusterIds, 1 + CATEGORY_MORE);
    // Two clusters of the same wire story carry the same headline; the same
    // sentence twice in one section reads as a bug. Skipped cards are NOT
    // claimed, so another section can still use them.
    const seenTitles = new Set<string>();
    const unique: ClusterCard[] = [];
    for (const card of cards) {
      const key = card.title.trim().toLowerCase();
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      unique.push(card);
    }
    if (unique.length === 0) return false;
    for (const card of unique) usedClusterIds.add(card.clusterId);
    categories.push({ category, artsToday, lead: unique[0], more: unique.slice(1) });
    return true;
  };
  await addCategory("Geopolítica");
  await addCategory("Economia");
  // The rotating slot walks its candidates until one still has a free cluster.
  for (const category of rotatingCategoryOrder(stats)) {
    if (await addCategory(category)) break;
  }

  // ── Bottom band ── each side's own top keyword, mutually distinct.
  const bottom: BottomColumn[] = [];
  for (const side of ["esquerda", "centro", "direita"] as Side[]) {
    let item: BottomItem | null = null;
    for (const hours of [24, 48]) {
      if (item) break;
      const kws = await sideKeywords(side, hours);
      for (const { kw } of kws) {
        if (usedKeywords.has(kw)) continue;
        const article = await latestSideArticle(side, kw, hours, usedArticleIds);
        if (!article) continue;
        const spectrum = await kwSpectrum(kw, hours);
        usedKeywords.add(kw);
        usedArticleIds.add(article.id);
        item = {
          kw,
          arts: spectrum.arts,
          outlets: spectrum.outlets,
          hours,
          sides: spectrum.sides,
          article,
        };
        break;
      }
    }
    bottom.push({ side, item });
  }

  return { chips, bottom, hero, alta, briefing, featured, weekly, pair, topics, categories };
}
