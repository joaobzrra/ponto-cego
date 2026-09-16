import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { Blindspot } from "./blindspots";
import { cardEligible, cardTitle, clusterHasFace } from "./card-eligibility";

/*
 * Sections below the home grid (spec 2026-09-03 §6 and §7).
 *   Topic sections: keyed by a trending keyword; lead = the keyword's
 *   largest 24h cluster; blindspots come from the ONE ranking homeData
 *   already holds (filtered by keyword there, not re-queried here).
 *   Category sections: Geopolítica, Economia and one rotating thin category;
 *   lead + three more clusters of the same category. Category of a cluster
 *   is the mode of its banded articles' category. Not blindspots.
 */
export type ClusterCard = {
  clusterId: number;
  title: string;
  arts: number;
  outlets: number;
  sides: { esquerda: number; centro: number; direita: number };
  thumbnailPath: string | null;
};

export type TopicSection = { kw: string; lead: ClusterCard; blindspots: Blindspot[] };
export type CategorySection = { category: string; artsToday: number; lead: ClusterCard; more: ClusterCard[] };

export const ROTATING_CATEGORIES = ["Saúde", "Educação", "Cultura", "Meio Ambiente"] as const;
export type CategoryStat = { category: string; topOutlets: number; topArts: number; clusters: number };

/**
 * The thin categories eligible for the rotating slot, best first. Returned as
 * a list rather than a single pick because `categoryStats` counts clusters
 * before the page's used-id set is applied: the strongest candidate can yield
 * zero cards once the grid above has taken its clusters, and the slot then
 * falls through to the next candidate instead of rendering nothing.
 */
export function rotatingCategoryOrder(stats: CategoryStat[]): string[] {
  const allowed = new Set<string>(ROTATING_CATEGORIES);
  return stats
    .filter((s) => allowed.has(s.category) && s.clusters > 0)
    .sort((a, b) => b.topOutlets - a.topOutlets || b.topArts - a.topArts || a.category.localeCompare(b.category))
    .map((s) => s.category);
}

export function pickRotatingCategory(stats: CategoryStat[]): string | null {
  return rotatingCategoryOrder(stats)[0] ?? null;
}

const CARD_SELECT = sql`
  c.id, c.title,
  count(a.id)::int as arts,
  count(distinct a.outlet_id) filter (where a.band is not null and a.band <> 'NC')::int as outlets,
  count(distinct a.outlet_id) filter (where a.band in ('E3','E2','E1'))::int as e_out,
  count(distinct a.outlet_id) filter (where a.band = 'C')::int as c_out,
  count(distinct a.outlet_id) filter (where a.band in ('D1','D2','D3'))::int as d_out,
  (select x.thumbnail_path from articles x
    where x.cluster_id = c.id and x.thumbnail_path is not null
      and x.status = 'published' and x.duplicate_of is null
      and ${cardEligible("x")}
    order by coalesce(x.published_at, x.fetched_at) desc limit 1) as thumbnail_path,
  ${cardTitle("c")} as card_title`;

function toCard(r: Record<string, unknown>): ClusterCard {
  return {
    clusterId: Number(r.id),
    // See card-eligibility.ts: clusters.title can be a flagged outlet's headline.
    title: String(r.card_title ?? r.title),
    arts: Number(r.arts),
    outlets: Number(r.outlets),
    sides: { esquerda: Number(r.e_out), centro: Number(r.c_out), direita: Number(r.d_out) },
    thumbnailPath: r.thumbnail_path === null || r.thumbnail_path === undefined ? null : String(r.thumbnail_path),
  };
}

const notIn = (ids: Set<number>) =>
  ids.size === 0 ? sql`true` : sql`c.id not in (${sql.join([...ids].map((i) => sql`${i}`), sql`, `)})`;

/** The keyword's largest cluster of the last 24h by distinct banded outlets. */
export async function keywordLead(kw: string, exclude: Set<number>): Promise<ClusterCard | null> {
  const result = await db.execute(sql`
    select ${CARD_SELECT}
    from clusters c
    join articles a on a.cluster_id = c.id and a.status = 'published' and a.duplicate_of is null
    where c.status = 'active'
      and ${notIn(exclude)}
      and ${clusterHasFace("c")}
      and exists (
        select 1 from articles k, jsonb_array_elements_text(k.keywords) as kk
        where k.cluster_id = c.id and lower(kk) = ${kw.toLowerCase()}
          and k.band is not null and k.band <> 'NC'
          and k.fetched_at > now() - interval '24 hours')
    group by c.id, c.title
    having count(distinct a.outlet_id) filter (where a.band is not null and a.band <> 'NC') >= 1
    order by outlets desc, arts desc
    limit 1
  `);
  const r = (result.rows as Array<Record<string, unknown>>)[0];
  return r ? toCard(r) : null;
}

/** Clusters of one category (mode of banded articles) active in the last 24h. */
export async function categoryClusters(
  category: string,
  exclude: Set<number>,
  limit: number,
): Promise<{ artsToday: number; cards: ClusterCard[] }> {
  const result = await db.execute(sql`
    with cat as (
      select a.cluster_id, mode() within group (order by a.category) as category
      from articles a
      where a.cluster_id is not null and a.status = 'published' and a.duplicate_of is null
        and a.band is not null and a.band <> 'NC' and a.category is not null
        and a.fetched_at > now() - interval '24 hours'
      group by a.cluster_id
    )
    select ${CARD_SELECT}
    from clusters c
    join cat on cat.cluster_id = c.id and cat.category = ${category}
    join articles a on a.cluster_id = c.id and a.status = 'published' and a.duplicate_of is null
    where c.status = 'active' and ${notIn(exclude)} and ${clusterHasFace("c")}
    group by c.id, c.title
    order by outlets desc, arts desc
    limit ${limit}
  `);
  const arts = await db.execute(sql`
    select count(*)::int as n from articles a
    where a.status = 'published' and a.duplicate_of is null
      and a.band is not null and a.band <> 'NC'
      and a.category = ${category}
      and a.fetched_at > now() - interval '24 hours'
  `);
  return {
    artsToday: Number((arts.rows[0] as { n: number }).n),
    cards: (result.rows as Array<Record<string, unknown>>).map(toCard),
  };
}

/** Per category: strongest 24h cluster (outlets, arts) and cluster count, for the rotation. */
export async function categoryStats(): Promise<CategoryStat[]> {
  const result = await db.execute(sql`
    with cat as (
      select a.cluster_id, mode() within group (order by a.category) as category
      from articles a
      where a.cluster_id is not null and a.status = 'published' and a.duplicate_of is null
        and a.band is not null and a.band <> 'NC' and a.category is not null
        and a.fetched_at > now() - interval '24 hours'
      group by a.cluster_id
    ), per_cluster as (
      select cat.category, c.id,
             count(distinct a.outlet_id) filter (where a.band is not null and a.band <> 'NC')::int as outlets,
             count(a.id)::int as arts
      from cat join clusters c on c.id = cat.cluster_id and c.status = 'active'
      join articles a on a.cluster_id = c.id and a.status = 'published' and a.duplicate_of is null
      group by cat.category, c.id
    )
    select category, max(outlets)::int as top_outlets,
           (array_agg(arts order by outlets desc, arts desc))[1]::int as top_arts,
           count(*)::int as clusters
    from per_cluster group by category
  `);
  return (result.rows as Array<Record<string, unknown>>).map((r) => ({
    category: String(r.category),
    topOutlets: Number(r.top_outlets),
    topArts: Number(r.top_arts),
    clusters: Number(r.clusters),
  }));
}
