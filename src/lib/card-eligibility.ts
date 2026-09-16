import { sql, type SQL } from "drizzle-orm";

/*
 * Who may be the FACE of a card.
 *
 * Owner ruling 2026-09-04: an outlet carrying a public provenance warning
 * (`outlets.warning_label`, the red badge — today only Sputnik Brasil,
 * "Estatal Russa") must never supply the headline or the picture that stands
 * for an event on the home page. It still appears inside the cluster page and
 * in /noticias, and it still COUNTS in the spectrum meter — the ban is about
 * prominence, not arithmetic. Removing it from the math would change which
 * events register as blindspots at all, which is a different and much larger
 * decision.
 *
 * Why `warning_label` and not `owner_type = 'estatal'`: that column also holds
 * BBC News Brasil, DW Brasil, RFI Brasil and Agência Brasil — public
 * broadcasters and a domestic state wire, not state-controlled media. Banning
 * those from cards is not what was asked and would be a visible quality loss.
 * `warning_label` is the curated human judgement "this source needs a caveat",
 * so onboarding RT or CGTN means setting the label in /admin — no code change.
 *
 * Two things a card needs, and both must come from an eligible article:
 *   - the picture (every thumbnail subselect)
 *   - the headline. `clusters.title` is written ONCE at cluster.ts:289 from
 *     whichever article SEEDED the cluster and is never revisited, so when a
 *     flagged outlet published first its headline became the site's headline
 *     for that event permanently. Measured on production: 430 of 21,792 active
 *     clusters were titled by Sputnik. Cards therefore resolve their own title
 *     via `cardTitle` instead of trusting `clusters.title`.
 *
 * A cluster with NO eligible article has no clean face at all and is dropped
 * from card surfaces entirely (`clusterHasFace`). It stays reachable at /e/<id>
 * and in /noticias. Apply that predicate in SQL, BEFORE any LIMIT — filtering
 * in JS afterwards silently under-fills the rail.
 */

/** The alias is always a code literal from the surrounding query, never input. */
type Alias = string;

/** True when this ARTICLE row may supply a card's headline or picture. */
export function cardEligible(articleAlias: Alias): SQL {
  return sql`not exists (
    select 1 from outlets o_ce
    where o_ce.id = ${sql.raw(articleAlias)}.outlet_id
      and o_ce.warning_label is not null
  )`;
}

/** True when this CLUSTER has at least one article that may front a card. */
export function clusterHasFace(clusterAlias: Alias): SQL {
  return sql`exists (
    select 1 from articles a_ce
    where a_ce.cluster_id = ${sql.raw(clusterAlias)}.id
      and a_ce.status = 'published'
      and a_ce.duplicate_of is null
      and ${cardEligible("a_ce")}
  )`;
}

/**
 * The headline a card should show for this cluster.
 *
 * `clusters.title` is KEPT whenever some eligible article in the cluster
 * actually published under it, and replaced by the earliest eligible article's
 * title only when the stored title is exclusively a flagged outlet's headline.
 *
 * The narrowness is deliberate and was measured. Always taking "the earliest
 * eligible title" rewrote 996 of 21,863 active clusters, but only ~430 are
 * Sputnik-seeded; the rest changed because the earliest article is not always
 * the one that seeded the cluster (retroactive clustering attaches articles
 * with older published_at, and a seed later marked duplicate_of drops out of
 * the running). Those clusters had no problem to fix, so rewriting their
 * headline was churn the ruling never asked for.
 *
 * Null only when nothing is eligible — pair with `clusterHasFace` so that case
 * never reaches a card.
 */
export function cardTitle(clusterAlias: Alias): SQL {
  const c = sql.raw(clusterAlias);
  return sql`(
    case
      when exists (
        select 1 from articles a_keep
        where a_keep.cluster_id = ${c}.id
          and a_keep.status = 'published'
          and a_keep.duplicate_of is null
          and a_keep.title = ${c}.title
          and ${cardEligible("a_keep")}
      ) then ${c}.title
      else (
        select a_ct.title from articles a_ct
        where a_ct.cluster_id = ${c}.id
          and a_ct.status = 'published'
          and a_ct.duplicate_of is null
          and ${cardEligible("a_ct")}
        order by coalesce(a_ct.published_at, a_ct.fetched_at) asc
        limit 1
      )
    end
  )`;
}
