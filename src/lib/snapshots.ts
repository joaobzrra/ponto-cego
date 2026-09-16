import { writeFile } from "node:fs/promises";
import path from "node:path";
import { db, tables } from "@/db";
import { ensureDir, SNAPSHOTS_DIR } from "./paths";
import { compressSnapshot, snapshotFileName } from "./snapshot-codec";

/**
 * Raw snapshot retention (spec §3.2): keep fetched feed XML on disk for 7 days
 * per outlet so parse failures are debugged by diffing, not guessing. The
 * retention job deletes files + rows past the window.
 *
 * Stored gzipped since 2026-07-26 (~26% of raw). Nothing in the app reads these
 * back — the consumer is a human diagnosing a feed — so inspect them with
 * `zcat` / `gunzip -c` rather than opening them directly.
 */
export async function saveSnapshot(
  outletId: number,
  outletSlug: string,
  // `article_html` was retired 2026-07-26 (write-only, 2.6 GB) — see poller.ts.
  kind: "feed_xml",
  content: string,
  feedId?: number,
): Promise<number> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const relative = path.join(outletSlug, snapshotFileName(stamp, kind));
  const dir = ensureDir(path.join(SNAPSHOTS_DIR, outletSlug));
  const absolute = path.join(dir, path.basename(relative));
  await writeFile(absolute, compressSnapshot(content));
  const [row] = await db
    .insert(tables.rawSnapshots)
    .values({
      outletId,
      feedId: feedId ?? null,
      kind,
      filePath: relative,
      // Original size, so byte_size stays comparable across the gzip cutover
      // and still answers "how big is this outlet's feed?".
      byteSize: Buffer.byteLength(content, "utf8"),
    })
    .returning({ id: tables.rawSnapshots.id });
  return row.id;
}
