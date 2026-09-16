import { eq } from "drizzle-orm";
import { db, tables } from "@/db";

/*
 * Merge resolution.
 *
 * `mergeClusters` (admin/clusters/actions.ts) moves every article to the
 * target and marks the source status='merged' with merged_into set. Nothing
 * read that pointer, so every /e/<id> link shared before a merge 404'd: the
 * page counts members, finds none, and calls notFound(). Merging is a routine
 * admin action, so this quietly broke already-published links.
 *
 * A merge chain can be several hops (A→B, then B→C), and a bad sequence of
 * admin actions could in principle close a cycle, so the walk is capped and
 * cycle-safe rather than recursive.
 */

/** Hard stop for a merge chain — deep enough for any real sequence of merges. */
const MAX_HOPS = 8;

/**
 * Follow `merged_into` to the cluster that actually holds the articles.
 *
 * Returns the canonical id, or null when the id is unknown, the chain is
 * longer than MAX_HOPS, or it closes a cycle. Returns the id unchanged when
 * the cluster is active — callers can compare against their input to decide
 * whether a redirect is needed.
 */
export async function resolveCluster(clusterId: number): Promise<number | null> {
  let id = clusterId;
  const seen = new Set<number>();

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (seen.has(id)) return null;
    seen.add(id);

    const [row] = await db
      .select({ status: tables.clusters.status, mergedInto: tables.clusters.mergedInto })
      .from(tables.clusters)
      .where(eq(tables.clusters.id, id));

    if (!row) return null;
    if (row.status !== "merged" || row.mergedInto === null) return id;

    id = row.mergedInto;
  }

  return null;
}
