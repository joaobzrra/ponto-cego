/**
 * Reach weighting (Análise de Assunto: reach-weighted prominence).
 *
 * Weight is derived from a public traffic-rank dataset (Tranco, CrUX-backed)
 * via ONE fixed, published rank -> weight mapping. This mapping is
 * deliberately the same for every outlet and every client — it is never
 * tuned per outlet, per client, or by hand. The only per-outlet override is
 * reachSource = 'manual', set explicitly in the admin panel, which this
 * module never touches.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { fetchWithTimeout } from "@/lib/http";
import { writeAudit } from "@/lib/audit";

const TRANCO_LATEST_API = "https://tranco-list.eu/api/lists/date/latest";
const TRANCO_ZIP_FALLBACK = "https://tranco-list.eu/top-1m.csv.zip";
// Windows-native bsdtar (System32) — handles zip via -xf; Git's bundled GNU
// tar on PATH may not, so the full path is used deliberately.
const WINDOWS_TAR = "C:\\Windows\\System32\\tar.exe";

/**
 * Published rank -> weight tiers. Fixed and public — never edit per outlet.
 * Beyond 1,000,000 (or unranked) falls through to the floor weight.
 */
export const RANK_WEIGHT: Array<{ maxRank: number; weight: number }> = [
  { maxRank: 1_000, weight: 100 },
  { maxRank: 10_000, weight: 40 },
  { maxRank: 100_000, weight: 15 },
  { maxRank: 1_000_000, weight: 5 },
];
const UNRANKED_WEIGHT = 1;

export function weightForRank(rank: number | null): number {
  if (rank === null) return UNRANKED_WEIGHT;
  for (const tier of RANK_WEIGHT) {
    if (rank <= tier.maxRank) return tier.weight;
  }
  return UNRANKED_WEIGHT;
}

/**
 * Global-popularity multiplier — the second axis (2026-07-21). CrUX publishes
 * coarse rank BUCKETS, so half our outlets share the Brazilian top-1,000
 * bucket and would otherwise all weigh the same (G1 == a small partisan site).
 * The global bucket spreads that tier apart without leaving CrUX.
 *
 * The bands are chosen so tiers can NEVER invert: the best a lower Brazilian
 * tier can reach (40 x 1.5 = 60) stays below the worst of the tier above
 * it (100 x 0.75 = 75). Brazilian rank always dominates; global only refines.
 */
export const GLOBAL_MULTIPLIER: Array<{ maxRank: number; factor: number }> = [
  { maxRank: 1_000, factor: 1.5 },
  { maxRank: 10_000, factor: 1.25 },
  { maxRank: 100_000, factor: 1.0 },
  { maxRank: 1_000_000, factor: 0.85 },
];
const UNRANKED_GLOBAL_FACTOR = 0.75;

export function globalFactor(rank: number | null): number {
  if (rank === null) return UNRANKED_GLOBAL_FACTOR;
  for (const band of GLOBAL_MULTIPLIER) {
    if (rank <= band.maxRank) return band.factor;
  }
  return UNRANKED_GLOBAL_FACTOR;
}

/** Final weight: Brazilian tier as the base, global bucket as the refinement. */
export function weightForRanks(brRank: number | null, globalRank: number | null): number {
  return Math.round(weightForRank(brRank) * globalFactor(globalRank) * 10) / 10;
}

/**
 * Most common article hostname per enabled outlet, lowercased, www.-stripped.
 * One query: LATERAL join picks the top hostname by article count per outlet.
 */
export async function outletDomains(): Promise<Map<number, string>> {
  const result = await db.execute(sql`
    select o.id as outlet_id, h.host
    from outlets o
    join lateral (
      select lower(regexp_replace(
               substring(a.canonical_url from '^https?://([^/]+)'),
               '^www\\.', ''
             )) as host,
             count(*) as c
      from articles a
      where a.outlet_id = o.id
      group by host
      order by c desc
      limit 1
    ) h on true
    where o.enabled = true
  `);
  const out = new Map<number, string>();
  for (const r of result.rows as Array<{ outlet_id: number; host: string }>) {
    out.set(Number(r.outlet_id), r.host);
  }
  return out;
}

const BR_SECOND_LEVEL_TLDS = new Set([
  "com.br",
  "org.br",
  "net.br",
  "gov.br",
  "jus.br",
  "leg.br",
]);

/** Reduce a hostname to its registrable domain for Tranco (PLD) matching. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  if (BR_SECOND_LEVEL_TLDS.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

async function streamToFile(res: Response, filePath: string): Promise<void> {
  if (!res.body) throw new Error("Tranco response has no body");
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(filePath));
}

/** Lightweight metadata-only call, reused for audit provenance. */
async function fetchTrancoListMeta(): Promise<{ listId: string; createdOn: string } | null> {
  try {
    const res = await fetchWithTimeout(TRANCO_LATEST_API, { timeoutMs: 15_000 });
    if (!res.ok) return null;
    const info = (await res.json()) as { list_id?: string; created_on?: string };
    if (!info.list_id) return null;
    return { listId: info.list_id, createdOn: info.created_on ?? "" };
  } catch {
    return null;
  }
}

/** Downloads the current Tranco list to a local CSV path, API first, zip fallback. */
async function downloadTrancoCsv(): Promise<string> {
  try {
    const apiRes = await fetchWithTimeout(TRANCO_LATEST_API, { timeoutMs: 15_000 });
    if (apiRes.ok) {
      const info = (await apiRes.json()) as { download?: string };
      if (info.download) {
        const csvRes = await fetchWithTimeout(info.download, { timeoutMs: 60_000 });
        if (csvRes.ok) {
          const csvPath = path.join(os.tmpdir(), `tranco-${Date.now()}.csv`);
          await streamToFile(csvRes, csvPath);
          return csvPath;
        }
      }
    }
  } catch {
    // fall through to zip fallback below
  }

  const zipRes = await fetchWithTimeout(TRANCO_ZIP_FALLBACK, { timeoutMs: 60_000 });
  if (!zipRes.ok) {
    throw new Error(`Tranco list unreachable: API and zip fallback both failed (zip HTTP ${zipRes.status})`);
  }
  const zipPath = path.join(os.tmpdir(), `tranco-${Date.now()}.zip`);
  await streamToFile(zipRes, zipPath);
  const extractDir = path.join(os.tmpdir(), `tranco-extract-${Date.now()}`);
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync(WINDOWS_TAR, ["-xf", zipPath, "-C", extractDir]);
  fs.rmSync(zipPath, { force: true });
  return path.join(extractDir, "top-1m.csv");
}

/**
 * Ranks for the given hosts from the current Tranco top-1M list. Matches
 * each host by exact hostname first, then by its registrable domain (Tranco
 * publishes pay-level domains). Scans the ~1M-line CSV once, keeping only
 * the rows that match a requested domain — never materializes the full list.
 */
export async function fetchTrancoRanks(hosts: string[]): Promise<Map<string, number>> {
  const targets = new Set<string>();
  for (const h of hosts) {
    targets.add(h);
    targets.add(registrableDomain(h));
  }

  const csvPath = await downloadTrancoCsv();
  const domainRank = new Map<string, number>();
  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(csvPath),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const idx = line.indexOf(",");
      if (idx < 0) continue;
      const domain = line.slice(idx + 1).trim().toLowerCase();
      if (!targets.has(domain) || domainRank.has(domain)) continue;
      const rank = Number(line.slice(0, idx));
      if (Number.isFinite(rank)) domainRank.set(domain, rank);
    }
  } finally {
    fs.rmSync(csvPath, { force: true });
  }

  const result = new Map<string, number>();
  for (const h of hosts) {
    const rank = domainRank.get(h) ?? domainRank.get(registrableDomain(h));
    if (rank !== undefined) result.set(h, rank);
  }
  return result;
}

/**
 * Refreshes reachWeight/reachRank/reachSource for every enabled outlet whose
 * reachSource is not 'manual'. Manual overrides are never touched.
 */
export async function applyTrancoWeights(): Promise<{
  updated: number;
  skippedManual: number;
  skippedCrux: number;
  unranked: number;
}> {
  const domains = await outletDomains();
  const hosts = [...new Set(domains.values())];
  const ranks = await fetchTrancoRanks(hosts);
  const meta = await fetchTrancoListMeta();

  const outlets = await db
    .select({
      id: tables.outlets.id,
      reachSource: tables.outlets.reachSource,
      reachUpdatedAt: tables.outlets.reachUpdatedAt,
    })
    .from(tables.outlets)
    .where(eq(tables.outlets.enabled, true));

  let updated = 0;
  let skippedManual = 0;
  let skippedCrux = 0;
  let unranked = 0;
  const now = new Date();

  for (const outlet of outlets) {
    if (outlet.reachSource === "manual") {
      skippedManual++;
      continue;
    }
    // Source hierarchy: CrUX ranks ORIGINS (g1.globo.com ≠ globo.com) and is
    // the canonical production source — Tranco is the fallback and must not
    // clobber a fresh CrUX value. Stale CrUX (>45d, e.g. creds revoked) is
    // taken over so outlets never silently freeze.
    if (
      outlet.reachSource === "crux" &&
      outlet.reachUpdatedAt !== null &&
      now.getTime() - outlet.reachUpdatedAt.getTime() < 45 * 24 * 60 * 60 * 1000
    ) {
      skippedCrux++;
      continue;
    }
    const host = domains.get(outlet.id);
    const rank = host ? ranks.get(host) ?? null : null;
    if (rank === null) unranked++;
    await db
      .update(tables.outlets)
      .set({
        reachWeight: weightForRank(rank),
        reachRank: rank,
        reachSource: "tranco",
        reachUpdatedAt: now,
      })
      .where(eq(tables.outlets.id, outlet.id));
    updated++;
  }

  const summary = { updated, skippedManual, skippedCrux, unranked };
  await writeAudit(null, "reach.tranco_update", undefined, {
    ...summary,
    trancoListId: meta?.listId ?? null,
    trancoListDate: meta?.createdOn ?? null,
  });
  return summary;
}
