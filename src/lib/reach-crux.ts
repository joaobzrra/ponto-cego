import { BigQuery } from "@google-cloud/bigquery";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { writeAudit } from "./audit";

/*
 * CrUX reach source — the CANONICAL one for production (research 2026-07-20):
 * Google's Chrome UX Report public BigQuery dataset exposes an origin-level
 * popularity rank (experimental.popularity.rank, bucketed 1k/5k/10k/…/50M)
 * per country. Unlike Tranco it ranks ORIGINS, so g1.globo.com and
 * oglobo.globo.com are ranked separately — decisive for Brazilian outlets.
 * The HTTP CrUX API does NOT expose rank; BigQuery is the only route.
 *
 * Auth: GOOGLE_APPLICATION_CREDENTIALS (service-account JSON path) +
 * CRUX_BQ_PROJECT (the billing project id). Both absent → callers should
 * skip CrUX and fall back to Tranco (src/lib/reach.ts).
 *
 * The rank→weight mapping is the same fixed public table for every source
 * (weightForRank) — never tuned per outlet or client.
 */

export function cruxConfigured(): boolean {
  return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.CRUX_BQ_PROJECT);
}

/** Latest CrUX month is usually the previous calendar month; the table for a
 * month lands mid-following-month, so we try up to 3 months back. */
export function candidateMonths(now = new Date()): number[] {
  const out: number[] = [];
  for (let back = 1; back <= 3; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    out.push(d.getFullYear() * 100 + (d.getMonth() + 1));
  }
  return out;
}

/**
 * Queries the clustered experimental.country table for our origins in Brazil.
 * Tries the newest month first and returns the first month with any rows.
 * For each hostname both bare and www. origins are tried; the best (lowest)
 * rank wins.
 */
function bestByHost(rows: Array<{ origin: string; rank: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const host = r.origin.replace(/^https:\/\/(www\.)?/, "");
    const prev = out.get(host);
    if (prev === undefined || r.rank < prev) out.set(host, Number(r.rank));
  }
  return out;
}

/**
 * Both axes in one pass: the Brazilian bucket (the base tier) and the global
 * bucket (the refinement that spreads Brazil's crowded top-1,000 tier apart).
 */
export async function fetchCruxRanks(
  hosts: string[],
): Promise<{ month: number; br: Map<string, number>; global: Map<string, number> } | null> {
  const bq = new BigQuery({ projectId: process.env.CRUX_BQ_PROJECT });
  const origins = hosts.flatMap((h) => [`https://${h}`, `https://www.${h}`]);

  for (const month of candidateMonths()) {
    const [brRows] = await bq.query({
      query: `
        SELECT DISTINCT origin, experimental.popularity.rank AS rank
        FROM \`chrome-ux-report.experimental.country\`
        WHERE yyyymm = @month AND country_code = 'br' AND origin IN UNNEST(@origins)`,
      params: { month, origins },
    });
    if (brRows.length === 0) continue;

    const [globalRows] = await bq.query({
      query: `
        SELECT DISTINCT origin, experimental.popularity.rank AS rank
        FROM \`chrome-ux-report.experimental.global\`
        WHERE yyyymm = @month AND origin IN UNNEST(@origins)`,
      params: { month, origins },
    });

    return {
      month,
      br: bestByHost(brRows as Array<{ origin: string; rank: number }>),
      global: bestByHost(globalRows as Array<{ origin: string; rank: number }>),
    };
  }
  return null;
}

/**
 * Applies CrUX weights to every enabled outlet that is not manually
 * overridden. Outlets absent from CrUX keep whatever a previous source set
 * (Tranco fallback fills those) — CrUX absence is "not popular enough for
 * the BR table", not "audience zero".
 */
export async function applyCruxWeights(
  outletHosts: Map<number, string>,
  weightForRanks: (brRank: number | null, globalRank: number | null) => number,
): Promise<{ month: number; updated: number; skippedManual: number; missing: number } | null> {
  const hosts = [...new Set(outletHosts.values())];
  const res = await fetchCruxRanks(hosts);
  if (!res) return null;

  let updated = 0;
  let skippedManual = 0;
  let missing = 0;
  for (const [outletId, host] of outletHosts) {
    const key = host.replace(/^www\./, "");
    const rank = res.br.get(key);
    if (rank === undefined) {
      missing++;
      continue;
    }
    // reach_rank stores the BR bucket — the number a reader can look up; the
    // global bucket only shapes the weight (see weightForRanks).
    const done = await db.execute(sql`
      update outlets
      set reach_weight = ${weightForRanks(rank, res.global.get(key) ?? null)},
          reach_source = 'crux',
          reach_rank = ${rank},
          reach_updated_at = now()
      where id = ${outletId} and coalesce(reach_source, '') <> 'manual'
    `);
    if (Number(done.rowCount ?? 0) > 0) updated++;
    else skippedManual++;
  }
  await writeAudit(null, "reach.crux_update", undefined, {
    month: res.month,
    updated,
    skippedManual,
    missing,
  });
  return { month: res.month, updated, skippedManual, missing };
}
