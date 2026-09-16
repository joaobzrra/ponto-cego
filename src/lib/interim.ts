import { sql } from "drizzle-orm";
import { db, tables } from "@/db";

/*
 * Interim front-page data — stage-5 stand-ins, all computed from what the
 * pipeline already produces (keywords + bands). Each export names the stage 5
 * feature that replaces it; delete this file when clusters take over.
 *
 * Windows are 48h (matching the columns), not 24h: keywords/bands come from
 * the classifier, so tighter windows go blank whenever the spend cap pauses
 * classification.
 */

export type InterimHero = {
  kw: string;
  outletCount: number;
  bands: { esquerda: number; centro: number; direita: number; nc: number };
  article: {
    id: number;
    title: string;
    excerpt: string | null;
    thumbnailPath: string | null;
    outletName: string;
    outletWarning: string | null;
    publishedAt: Date | null;
  };
};

/**
 * Data-driven Destaque do Dia: the most-covered keyword of the last 48h
 * (≥3 distinct outlets) with its coverage's real band distribution and its
 * most recent illustrated headline. Replaced by the approved LLM synthesis
 * (destaque_drafts) once stage 5 clustering + SYNTHESIS_ENABLED land.
 */
export async function interimHero(): Promise<InterimHero | null> {
  // Ranked by POLITICAL coverage, not raw volume — otherwise NC-heavy
  // keywords (futebol, horóscopo) take the hero on slow news days.
  const top = await db.execute(sql`
    select lower(kw) as kw,
           count(distinct ${tables.articles.outletId})::int as outlets,
           count(*) filter (where ${tables.articles.band} is not null
                              and ${tables.articles.band} <> 'NC')::int as political
    from ${tables.articles}, jsonb_array_elements_text(${tables.articles.keywords}) as kw
    where ${tables.articles.fetchedAt} > now() - interval '48 hours'
      and ${tables.articles.status} = 'published'
      and ${tables.articles.duplicateOf} is null
      and length(kw) > 2
    group by lower(kw)
    having count(distinct ${tables.articles.outletId}) >= 3
       and count(*) filter (where ${tables.articles.band} is not null
                              and ${tables.articles.band} <> 'NC') >= 3
    order by political desc, outlets desc, count(*) desc
    limit 1
  `);
  const topRow = top.rows[0] as { kw: string; outlets: number } | undefined;
  if (!topRow) return null;

  const kwMatch = sql`exists (
    select 1 from jsonb_array_elements_text(${tables.articles.keywords}) as k
    where lower(k) = ${topRow.kw}
  )`;

  const [bands, pick] = await Promise.all([
    db.execute(sql`
      select
        count(*) filter (where ${tables.articles.band} in ('E3','E2','E1'))::int as esquerda,
        count(*) filter (where ${tables.articles.band} = 'C')::int as centro,
        count(*) filter (where ${tables.articles.band} in ('D1','D2','D3'))::int as direita,
        count(*) filter (where ${tables.articles.band} = 'NC')::int as nc
      from ${tables.articles}
      where ${tables.articles.fetchedAt} > now() - interval '48 hours'
        and ${tables.articles.status} = 'published'
        and ${tables.articles.duplicateOf} is null
        and ${kwMatch}
    `),
    db.execute(sql`
      select a.id, a.title, a.excerpt, a.thumbnail_path, a.published_at, o.name, o.warning_label
      from ${tables.articles} a
      join ${tables.outlets} o on o.id = a.outlet_id
      where a.fetched_at > now() - interval '48 hours'
        and a.status = 'published'
        and a.duplicate_of is null
        and exists (
          select 1 from jsonb_array_elements_text(a.keywords) as k
          where lower(k) = ${topRow.kw}
        )
        and o.warning_label is null
      order by (a.band is not null and a.band <> 'NC') desc,
               (a.thumbnail_path is not null) desc,
               coalesce(a.published_at, a.fetched_at) desc
      limit 1
    `),
  ]);

  const b = bands.rows[0] as InterimHero["bands"] | undefined;
  const a = pick.rows[0] as
    | {
        id: number;
        title: string;
        excerpt: string | null;
        thumbnail_path: string | null;
        published_at: string | Date | null;
        name: string;
        warning_label: string | null;
      }
    | undefined;
  if (!b || !a) return null;

  return {
    kw: topRow.kw,
    outletCount: topRow.outlets,
    bands: b,
    article: {
      id: a.id,
      title: a.title,
      excerpt: a.excerpt,
      thumbnailPath: a.thumbnail_path,
      outletName: a.name,
      outletWarning: a.warning_label,
      publishedAt: a.published_at ? new Date(a.published_at) : null,
    },
  };
}

// subnoticiadosKeywords() (keyword-level blindspots) retired 2026-07-18 —
// the cluster-level subnoticiados() in classification.ts is live everywhere.
