/**
 * Gzip codec for raw feed snapshots. Kept dependency-free (no db, no fs) so the
 * UTF-8 round-trip can be unit-tested — snapshots are the provenance record, so
 * silent corruption there is the worst failure mode this file has.
 *
 * Measured on 40 real snapshots (2026-07-26): 3.37 MB → 879 KB, i.e. 26%.
 * Level 9 because a snapshot is written once and read approximately never; the
 * few ms of extra CPU are invisible next to the feed fetch that produced it.
 */
import { gunzipSync, gzipSync } from "node:zlib";

const GZIP_LEVEL = 9;

export function compressSnapshot(content: string): Buffer {
  return gzipSync(Buffer.from(content, "utf8"), { level: GZIP_LEVEL });
}

export function decompressSnapshot(compressed: Buffer): string {
  return gunzipSync(compressed).toString("utf8");
}

/** Relative filename for a snapshot. `.xml.gz` so `gunzip`/`zcat` just work. */
export function snapshotFileName(stamp: string, kind: "feed_xml"): string {
  return `${stamp}-${kind}.xml.gz`;
}
