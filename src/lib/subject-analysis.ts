import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { SIDE_BANDS, type Side, type SideOutlets } from "./home";

/*
 * Análise de Assunto (deterministic layer, .PLANNING/profitability.MD): given a
 * free-text subject, compute coverage metrics straight from the corpus — no
 * LLM anywhere. One matcher CTE feeds every aggregate so "what counts as a
 * mention" is defined in exactly one place.
 *
 * Matching is keywords + title only: full article text is never stored (spec
 * §3.1 hard rule), and keywords come from the classifier. NC exclusion follows
 * clusterAggregate: NC/null-band articles count toward volume but never toward
 * spectrum math.
 *
 * Unit rules (design review 2026-07-20): subject-level bias is measured PER
 * ARTICLE. The blindspot fires on ARTICLE share — deliberately different from
 * the homepage's per-event outlet rule, because at subject level the story is
 * coverage intensity, not absence (all of a side's outlets may have covered a
 * subject a handful of times while the other side floods it). Outlet counts
 * per side OVERLAP (one outlet's articles can land on several bands), so they
 * are reach context, never a partition.
 */

/** Blindspot threshold shared with the homepage rule (≤20%, exactly one side). */
const BLINDSPOT_MAX_SHARE = 0.2;
/** Subject-level guards so a thin subject can't false-flag. */
const BLINDSPOT_MIN_ARTICLES = 30;
const BLINDSPOT_MIN_OUTLETS = 5;
/** Recent-trend deadband: ±15% between the 2-day windows reads as "estável". */
const TREND_UP = 1.15;
const TREND_DOWN = 0.85;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SubjectDay = { day: string; total: number; inTitle: number };

export type Trend = {
  /** Day (local key) with the highest volume inside the current window. */
  peakDay: string | null;
  /** Last 2 full days vs the 2 before them; today (partial) never counts. */
  direction: "subindo" | "caindo" | "estável";
};

/** Cheap head-to-head snapshot for ONE subject — the shape shared by `self`
 * and every entry in `rivalReports` so the UI can render one comparison
 * table without special-casing the main subject. */
export type CompactSubject = {
  subject: string;
  volume: number;
  priorVolume: number;
  /** null when priorVolume === 0 (no baseline yet). */
  deltaPct: number | null;
  outlets: number;
  /** Share of matched articles (window) with the term in the title, 0..1. */
  headlineRate: number;
  /** Banded article counts per side — NC/null excluded, same rule as spectrum. */
  articles: SideOutlets;
  /** Σ reach_weight of the publishing outlet over matched articles; null
   * when no matched article has a weighted outlet. */
  exposure: number | null;
};

/** Reference distribution of subject volumes, built from the classifier's
 * own keywords in the window — used to place a subject's volume in context. */
export type SubjectBenchmark = {
  /** Volumes of every reference keyword in the window, ascending — the distribution. */
  volumes: number[];
  median: number;
  p90: number;
};

export type SubjectReport = {
  subject: string;
  days: number;
  /** 2×days points, oldest first — prior window + current window. */
  daily: SubjectDay[];
  totals: {
    volume: number;
    priorVolume: number;
    /** null when the prior window is empty (no baseline yet). */
    deltaPct: number | null;
    /** Match composition — recall transparency, not "prominence". */
    inTitle: number;
    viaKeyword: number;
    outlets: number;
    /** Clusters with 2+ distinct outlets — singletons excluded (91% of raw). */
    events: number;
  };
  /**
   * Reach-weighted volume: Σ reach_weight of the publishing outlet over the
   * window's matched articles. null until at least one outlet has a weight;
   * weightedShare says how much of the volume the configured outlets cover.
   */
  exposure: { value: number; weightedShare: number } | null;
  trend: Trend;
  spectrum: {
    /** Banded article counts per side — THE unit for subject-level bias. */
    articles: SideOutlets;
    /** Distinct outlets per side. Overlapping sets — reach, not a partition. */
    outlets: SideOutlets;
    /** Of each side's articles, how many carry the term in the HEADLINE —
     * headline-vs-buried asymmetry ("prominence"). */
    inTitle: SideOutlets;
  };
  /** Reader behavior on the subject, from first-party events (no LLM). */
  reaction: {
    /** Site searches matching the subject in the window. */
    searches: number;
    /** Outbound clicks to outlets on matched articles. */
    clicks: number;
    clicksBySide: SideOutlets;
    /** "O rótulo está correto?" votes on matched articles. */
    feedbackAgree: number;
    feedbackDisagree: number;
  };
  /** Lead/follow timing over the subject's multi-outlet events. */
  firstMovers: Array<{
    name: string;
    slug: string;
    /** Multi-outlet subject events this outlet covered. */
    events: number;
    /** How many of those it was the FIRST to publish. */
    timesFirst: number;
    /** Median minutes behind the event's first article (0 = leads). */
    medianLagMin: number;
  }>;
  /** Fires on article share ≤20% (exactly one of esquerda/direita), guarded. */
  blindspot: { side: "esquerda" | "direita"; share: number } | null;
  /** Blindspot AND the recent daily trend still rising. */
  crossoverRisk: boolean;
  /** Co-mentions: of the subject's articles, how many also match each rival. */
  shareOfVoice: Array<{ subject: string; count: number }>;
  /** One compact snapshot per rival, same shape as `self` — head-to-head. */
  rivalReports: CompactSubject[];
  /** Where the subject's volume sits vs the classifier's own keyword
   * distribution in this window. null when the reference set is empty. */
  benchmark: { percentile: number; median: number } | null;
  /** The main subject in the same compact shape as `rivalReports`, so the
   * UI can render one comparison table without special-casing it. */
  self: CompactSubject;
  topOutlets: Array<{
    name: string;
    slug: string;
    /** Dominant band of the outlet's whole 90d classified output. */
    editorialLean: string | null;
    /** Dominant band of this outlet's articles ON THE SUBJECT. */
    subjectBand: string | null;
    arts: number;
    /** The outlet's TOTAL window output — dedication = arts / windowTotal. */
    windowTotal: number;
    /** Subject articles that were wire-copy duplicates (excluded from arts). */
    wireCopies: number;
  }>;
  topClusters: Array<{ clusterId: number; title: string; arts: number }>;
};

/** Escape LIKE wildcards so a subject like "100%" matches literally. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** The subject-match predicate on an `articles` row aliased `a` — the single
 * definition of "mentions the subject" (keyword exact OR title substring). */
function subjectMatch(subject: string): SQL {
  const kw = subject.trim().toLowerCase();
  const like = `%${escapeLike(subject.trim())}%`;
  return sql`(
    a.title ilike ${like}
    or exists (
      select 1 from jsonb_array_elements_text(coalesce(a.keywords, '[]'::jsonb)) as k
      where lower(k) = ${kw}
    )
  )`;
}

/**
 * The matcher CTE: published, non-duplicate articles inside the window whose
 * classifier keywords contain the subject exactly, or whose title mentions it
 * (substring — "tarifa" catches "tarifaço"; loose on purpose, and the report
 * discloses the composition via in_title/in_kw).
 */
function matchedCte(subject: string, windowDays: number): SQL {
  const kw = subject.trim().toLowerCase();
  const like = `%${escapeLike(subject.trim())}%`;
  return sql`
    matched as (
      select a.id, a.outlet_id, a.band, a.cluster_id,
             coalesce(a.published_at, a.fetched_at) as ts,
             (a.title ilike ${like}) as in_title,
             exists (
               select 1 from jsonb_array_elements_text(coalesce(a.keywords, '[]'::jsonb)) as k
               where lower(k) = ${kw}
             ) as in_kw
      from articles a
      where a.status = 'published'
        and a.duplicate_of is null
        and coalesce(a.published_at, a.fetched_at)
              >= now() - interval '${sql.raw(String(windowDays))} days'
        and ${subjectMatch(subject)}
    )`;
}

/** The rival condition for co-mention rows already inside `matched`. */
function rivalMatch(rival: string): SQL {
  const kw = rival.trim().toLowerCase();
  const like = `%${escapeLike(rival.trim())}%`;
  return sql`(
    a.title ilike ${like}
    or exists (
      select 1 from jsonb_array_elements_text(coalesce(a.keywords, '[]'::jsonb)) as k
      where lower(k) = ${kw}
    )
  )`;
}

const bandList = (side: Side): SQL =>
  sql.join(SIDE_BANDS[side].map((b) => sql`${b}`), sql`, `);

/** Postgres buckets ts::date in server-local time; format day keys to match. */
export const localDayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Cheap single-subject snapshot — ONE query over the same matchedCte/
 * windowClause pair subjectAnalysis uses, but none of its other aggregates
 * (no daily series, no reaction, no firstMovers). This is the per-rival path;
 * it must stay cheap since callers run it once per rival in parallel.
 */
export async function compactSubject(subject: string, days = 7): Promise<CompactSubject> {
  const cte = matchedCte(subject, days * 2);
  const windowClause = sql`ts >= now() - interval '${sql.raw(String(days))} days'`;

  const res = await db.execute(sql`
    with ${cte}
    select
      count(*) filter (where ${windowClause})::int as volume,
      count(*) filter (where not (${windowClause}))::int as prior_volume,
      count(distinct outlet_id) filter (where ${windowClause})::int as outlets,
      count(*) filter (where in_title and ${windowClause})::int as in_title,
      count(*) filter (where band in (${bandList("esquerda")}) and ${windowClause})::int as art_e,
      count(*) filter (where band in (${bandList("centro")}) and ${windowClause})::int as art_c,
      count(*) filter (where band in (${bandList("direita")}) and ${windowClause})::int as art_d,
      coalesce(sum(o.reach_weight) filter (where ${windowClause}), 0)::float as exposure,
      count(*) filter (where o.reach_weight is not null and ${windowClause})::int as weighted_arts
    from matched m
    left join outlets o on o.id = m.outlet_id
  `);

  const r = res.rows[0] as Record<string, unknown>;
  const volume = Number(r.volume);
  const priorVolume = Number(r.prior_volume);
  const weightedArts = Number(r.weighted_arts);

  return {
    subject: subject.trim(),
    volume,
    priorVolume,
    deltaPct: priorVolume > 0 ? Math.round(((volume - priorVolume) / priorVolume) * 100) : null,
    outlets: Number(r.outlets),
    headlineRate: volume > 0 ? Number(r.in_title) / volume : 0,
    articles: {
      esquerda: Number(r.art_e),
      centro: Number(r.art_c),
      direita: Number(r.art_d),
    },
    exposure: weightedArts > 0 ? Number(r.exposure) : null,
  };
}

/** Percentile position of `value` inside `volumes` — share of the reference
 * set at or below it. No interpolation on purpose: this only has to support
 * "more covered than X% of the subjects we track", not exact ranking. */
export function percentileOf(volumes: number[], value: number): number {
  if (volumes.length === 0) return 0;
  const countLe = volumes.filter((v) => v <= value).length;
  return countLe / volumes.length;
}

/** Nearest-rank percentile over an ascending array — used internally for
 * median/p90 on the same reference distribution percentileOf reads. */
function nearestRank(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(q * sortedAsc.length));
  return sortedAsc[idx];
}

/**
 * Reference distribution for "how covered is this subject compared to
 * others we track". Built from the classifier's own keywords — the same
 * source the homepage uses — not a hand-picked subject list, so it moves
 * with whatever the corpus is actually talking about.
 */
export async function subjectBenchmark(days = 7): Promise<SubjectBenchmark> {
  const res = await db.execute(sql`
    select lower(kw) as kw, count(*)::int as n
    from articles a, jsonb_array_elements_text(a.keywords) as kw
    where a.status = 'published' and a.duplicate_of is null
      and coalesce(a.published_at, a.fetched_at) >= now() - interval '${sql.raw(String(days))} days'
      and length(kw) > 2
    group by lower(kw) having count(*) >= 5
  `);
  const volumes = (res.rows as Array<Record<string, unknown>>)
    .map((r) => Number(r.n))
    .sort((a, b) => a - b);
  return {
    volumes,
    median: nearestRank(volumes, 0.5),
    p90: nearestRank(volumes, 0.9),
  };
}

export async function subjectAnalysis(
  subject: string,
  days = 7,
  rivals: string[] = [],
): Promise<SubjectReport> {
  const cte = matchedCte(subject, days * 2);
  const windowClause = sql`ts >= now() - interval '${sql.raw(String(days))} days'`;

  // Two extra branches run alongside the main aggregate batch, not after it:
  // the benchmark reference distribution and one compactSubject() per rival
  // (the cheap path — no full subjectAnalysis recursion). Nested so the rest
  // element for rivalRes (variable-length, from co-mention queries) can stay
  // the last item in its own destructure.
  const [mainRes, benchmarkData, rivalReports] = await Promise.all([
    Promise.all([
      db.execute(sql`
        with ${cte}
        select ts::date as day, count(*)::int as total,
               count(*) filter (where in_title)::int as in_title
        from matched group by 1 order by 1
      `),
      db.execute(sql`
        with ${cte}
        select count(*) filter (where ${windowClause})::int as volume,
               count(*) filter (where not (${windowClause}))::int as prior_volume,
               count(*) filter (where in_title and ${windowClause})::int as in_title,
               count(*) filter (where in_kw and ${windowClause})::int as via_keyword,
               count(distinct outlet_id) filter (where ${windowClause})::int as outlets
        from matched
      `),
      // Reach-weighted volume (exposure) — only over configured outlets.
      db.execute(sql`
        with ${cte}
        select coalesce(sum(o.reach_weight), 0)::float as exposure,
               count(*) filter (where o.reach_weight is not null)::int as weighted_arts,
               count(*)::int as total_arts
        from matched m join outlets o on o.id = m.outlet_id
        where ${windowClause}
      `),
      db.execute(sql`
        with ${cte}
        select count(*)::int as events
        from (
          select cluster_id from matched
          where ${windowClause} and cluster_id is not null
          group by cluster_id
          having count(distinct outlet_id) >= 2
        ) s
      `),
      db.execute(sql`
        with ${cte}
        select
          count(*) filter (where band in (${bandList("esquerda")}))::int as art_e,
          count(*) filter (where band in (${bandList("centro")}))::int as art_c,
          count(*) filter (where band in (${bandList("direita")}))::int as art_d,
          count(distinct outlet_id) filter (where band in (${bandList("esquerda")}))::int as out_e,
          count(distinct outlet_id) filter (where band in (${bandList("centro")}))::int as out_c,
          count(distinct outlet_id) filter (where band in (${bandList("direita")}))::int as out_d,
          count(*) filter (where in_title and band in (${bandList("esquerda")}))::int as title_e,
          count(*) filter (where in_title and band in (${bandList("centro")}))::int as title_c,
          count(*) filter (where in_title and band in (${bandList("direita")}))::int as title_d
        from matched
        where ${windowClause}
      `),
      // Reader reaction — first-party analytics scoped to the subject's
      // articles. events.band is denormalized at write time, so side splits
      // need no join back to articles.
      db.execute(sql`
        with ${cte}
        select
          count(*) filter (where e.type = 'clickout')::int as clicks,
          count(*) filter (where e.type = 'clickout' and e.band in (${bandList("esquerda")}))::int as clicks_e,
          count(*) filter (where e.type = 'clickout' and e.band = 'C')::int as clicks_c,
          count(*) filter (where e.type = 'clickout' and e.band in (${bandList("direita")}))::int as clicks_d
        from events e join matched m on m.id = e.article_id
        where not e.is_bot
          and e.created_at >= now() - interval '${sql.raw(String(days))} days'
      `),
      db.execute(sql`
        select count(*)::int as searches
        from events
        where type = 'search' and not is_bot
          and created_at >= now() - interval '${sql.raw(String(days))} days'
          and query ilike ${`%${escapeLike(subject.trim())}%`}
      `),
      db.execute(sql`
        with ${cte}
        select
          count(*) filter (where f.direction = 'agree')::int as agree,
          count(*) filter (where f.direction = 'disagree')::int as disagree
        from feedback f join matched m on m.id = f.article_id
        where f.created_at >= now() - interval '${sql.raw(String(days))} days'
      `),
      // Lead/follow: over the subject's multi-outlet events, when does each
      // outlet arrive relative to the event's first article? Timing uses ALL
      // published members of those clusters (the event's real start), not
      // only the articles that matched the subject string.
      db.execute(sql`
        with ${cte},
        subj_clusters as (
          select cluster_id from matched
          where ${windowClause} and cluster_id is not null
          group by cluster_id
          having count(distinct outlet_id) >= 2
        ),
        members as (
          select a.cluster_id, a.outlet_id,
                 min(coalesce(a.published_at, a.fetched_at)) as first_ts
          from articles a join subj_clusters sc on sc.cluster_id = a.cluster_id
          where a.status = 'published' and a.duplicate_of is null
          group by a.cluster_id, a.outlet_id
        ),
        starts as (
          select cluster_id, min(first_ts) as start_ts from members group by cluster_id
        )
        select o.name, o.slug,
               count(*)::int as events,
               count(*) filter (where m.first_ts = s.start_ts)::int as times_first,
               coalesce(percentile_cont(0.5) within group (
                 order by extract(epoch from (m.first_ts - s.start_ts)) / 60
               ), 0)::int as median_lag_min
        from members m
          join starts s on s.cluster_id = m.cluster_id
          join outlets o on o.id = m.outlet_id
        group by o.id, o.name, o.slug
        order by times_first desc, events desc
        limit 8
      `),
      db.execute(sql`
        with ${cte}
        select o.id, o.name, o.slug,
               mode() within group (order by m.band) as subject_band,
               count(*)::int as arts
        from matched m join outlets o on o.id = m.outlet_id
        where ${windowClause}
        group by o.id, o.name, o.slug
        order by arts desc limit 10
      `),
      db.execute(sql`
        with ${cte}
        select c.id, c.title, count(*)::int as arts
        from matched m join clusters c on c.id = m.cluster_id
        where ${windowClause}
        group by c.id, c.title
        order by arts desc limit 8
      `),
      // Co-mention, not global volume: rivals counted INSIDE the subject's
      // current-window articles, so "share of voice" means share of THIS
      // conversation (a ubiquitous rival no longer wins by default).
      ...rivals.map((r) =>
        db.execute(sql`
          with ${cte}
          select count(*)::int as n
          from matched m join articles a on a.id = m.id
          where m.ts >= now() - interval '${sql.raw(String(days))} days'
            and ${rivalMatch(r)}
        `),
      ),
    ]),
    subjectBenchmark(days),
    Promise.all(rivals.map((r) => compactSubject(r, days))),
  ]);

  const [
    dailyRes,
    summaryRes,
    exposureRes,
    eventsRes,
    sidesRes,
    clicksRes,
    searchesRes,
    votesRes,
    firstMoversRes,
    outletsRes,
    clustersRes,
    ...rivalRes
  ] = mainRes;

  const daily: SubjectDay[] = (dailyRes.rows as Array<Record<string, unknown>>).map((r) => ({
    day: r.day instanceof Date ? localDayKey(r.day) : String(r.day),
    total: Number(r.total),
    inTitle: Number(r.in_title),
  }));

  const s = summaryRes.rows[0] as Record<string, unknown>;
  const volume = Number(s.volume);
  const priorVolume = Number(s.prior_volume);

  const sd = sidesRes.rows[0] as Record<string, unknown>;
  const spectrum = {
    articles: {
      esquerda: Number(sd.art_e),
      centro: Number(sd.art_c),
      direita: Number(sd.art_d),
    } as SideOutlets,
    outlets: {
      esquerda: Number(sd.out_e),
      centro: Number(sd.out_c),
      direita: Number(sd.out_d),
    } as SideOutlets,
    inTitle: {
      esquerda: Number(sd.title_e),
      centro: Number(sd.title_c),
      direita: Number(sd.title_d),
    } as SideOutlets,
  };

  const ck = clicksRes.rows[0] as Record<string, unknown>;
  const votes = votesRes.rows[0] as Record<string, unknown>;
  const reaction: SubjectReport["reaction"] = {
    searches: Number((searchesRes.rows[0] as Record<string, unknown>).searches),
    clicks: Number(ck.clicks),
    clicksBySide: {
      esquerda: Number(ck.clicks_e),
      centro: Number(ck.clicks_c),
      direita: Number(ck.clicks_d),
    },
    feedbackAgree: Number(votes.agree),
    feedbackDisagree: Number(votes.disagree),
  };

  const firstMovers: SubjectReport["firstMovers"] = (
    firstMoversRes.rows as Array<Record<string, unknown>>
  ).map((r) => ({
    name: String(r.name),
    slug: String(r.slug),
    events: Number(r.events),
    timesFirst: Number(r.times_first),
    medianLagMin: Number(r.median_lag_min),
  }));

  // ── Blindspot: ARTICLE share, exactly one thin side, guarded against thin
  // subjects. Copy downstream must frame it as intensity ("9,5% dos artigos"),
  // never absence — the thin side's outlets usually HAVE covered the subject.
  const classified =
    spectrum.articles.esquerda + spectrum.articles.centro + spectrum.articles.direita;
  let blindspot: SubjectReport["blindspot"] = null;
  if (classified >= BLINDSPOT_MIN_ARTICLES && Number(s.outlets) >= BLINDSPOT_MIN_OUTLETS) {
    const weak = (["esquerda", "direita"] as const).filter(
      (side) => spectrum.articles[side] / classified <= BLINDSPOT_MAX_SHARE,
    );
    if (weak.length === 1) {
      blindspot = { side: weak[0], share: spectrum.articles[weak[0]] / classified };
    }
  }

  // ── Recent trend on FULL days only (today is always partial and would read
  // as a crash). Week-over-week stays in totals; direction decides crossover.
  const byDay = new Map(daily.map((d) => [d.day, d.total]));
  const dayVal = (back: number) => byDay.get(localDayKey(new Date(Date.now() - back * DAY_MS))) ?? 0;
  const last2 = dayVal(1) + dayVal(2);
  const prior2 = dayVal(3) + dayVal(4);
  const direction: Trend["direction"] =
    last2 > prior2 * TREND_UP ? "subindo" : last2 < prior2 * TREND_DOWN ? "caindo" : "estável";
  const windowStart = localDayKey(new Date(Date.now() - (days - 1) * DAY_MS));
  const currentDays = daily.filter((d) => d.day >= windowStart);
  const peakDay = currentDays.reduce<SubjectDay | null>(
    (best, d) => (best === null || d.total > best.total ? d : best),
    null,
  );
  const trend: Trend = { peakDay: peakDay?.day ?? null, direction };

  const crossoverRisk = blindspot !== null && direction === "subindo";

  // Per-outlet context in one follow-up query: 90d editorial lean (dominant
  // band — deliberately a different unit from subject_band, labeled so in the
  // UI), total window output (dedication denominator), and how many of the
  // outlet's subject articles were wire-copy duplicates (originality).
  const outletRows = outletsRes.rows as Array<Record<string, unknown>>;
  const statsById = new Map<
    number,
    { lean: string | null; windowTotal: number; wireCopies: number }
  >();
  if (outletRows.length > 0) {
    const statsRes = await db.execute(sql`
      select a.outlet_id,
             mode() within group (order by a.band)
               filter (where a.duplicate_of is null
                       and a.band is not null and a.band <> 'NC'
                       and a.fetched_at > now() - interval '90 days') as lean,
             count(*) filter (where a.duplicate_of is null
                       and coalesce(a.published_at, a.fetched_at)
                             >= now() - interval '${sql.raw(String(days))} days')::int as window_total,
             count(*) filter (where a.duplicate_of is not null
                       and coalesce(a.published_at, a.fetched_at)
                             >= now() - interval '${sql.raw(String(days))} days'
                       and ${subjectMatch(subject)})::int as wire_copies
      from articles a
      where a.status = 'published'
        and a.outlet_id in (${sql.join(outletRows.map((r) => sql`${Number(r.id)}`), sql`, `)})
      group by a.outlet_id
    `);
    for (const r of statsRes.rows as Array<Record<string, unknown>>) {
      statsById.set(Number(r.outlet_id), {
        lean: r.lean === null ? null : String(r.lean),
        windowTotal: Number(r.window_total),
        wireCopies: Number(r.wire_copies),
      });
    }
  }

  const ex = exposureRes.rows[0] as Record<string, unknown>;
  const exposure =
    Number(ex.weighted_arts) > 0
      ? {
          value: Number(ex.exposure),
          weightedShare: Number(ex.weighted_arts) / Math.max(1, Number(ex.total_arts)),
        }
      : null;

  // `self` mirrors compactSubject's shape from numbers already computed
  // above — no redundant query for the main subject.
  const self: CompactSubject = {
    subject: subject.trim(),
    volume,
    priorVolume,
    deltaPct: priorVolume > 0 ? Math.round(((volume - priorVolume) / priorVolume) * 100) : null,
    outlets: Number(s.outlets),
    headlineRate: volume > 0 ? Number(s.in_title) / volume : 0,
    articles: spectrum.articles,
    exposure: exposure?.value ?? null,
  };

  // Compare LIKE WITH LIKE: the reference distribution counts articles per
  // classifier keyword, so the subject must be measured the same way
  // (viaKeyword), not by total volume — which also counts title-substring
  // matches and would inflate every percentile.
  const benchmark =
    benchmarkData.volumes.length > 0
      ? {
          percentile: percentileOf(benchmarkData.volumes, Number(s.via_keyword)),
          median: benchmarkData.median,
        }
      : null;

  return {
    subject: subject.trim(),
    days,
    daily,
    totals: {
      volume,
      priorVolume,
      deltaPct: priorVolume > 0 ? Math.round(((volume - priorVolume) / priorVolume) * 100) : null,
      inTitle: Number(s.in_title),
      viaKeyword: Number(s.via_keyword),
      outlets: Number(s.outlets),
      events: Number((eventsRes.rows[0] as Record<string, unknown>).events),
    },
    exposure,
    trend,
    spectrum,
    reaction,
    firstMovers,
    blindspot,
    crossoverRisk,
    shareOfVoice: rivals.map((r, i) => ({
      subject: r,
      count: Number((rivalRes[i].rows[0] as Record<string, unknown>).n),
    })),
    rivalReports,
    benchmark,
    self,
    topOutlets: outletRows.map((r) => {
      const s = statsById.get(Number(r.id));
      return {
        name: String(r.name),
        slug: String(r.slug),
        editorialLean: s?.lean ?? null,
        subjectBand: r.subject_band === null ? null : String(r.subject_band),
        arts: Number(r.arts),
        windowTotal: s?.windowTotal ?? 0,
        wireCopies: s?.wireCopies ?? 0,
      };
    }),
    topClusters: (clustersRes.rows as Array<Record<string, unknown>>).map((r) => ({
      clusterId: Number(r.id),
      title: String(r.title),
      arts: Number(r.arts),
    })),
  };
}
