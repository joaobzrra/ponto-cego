import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { sql } from "drizzle-orm";
import { db, tables } from "../db";
import { fetchWithTimeout, readBodyCapped } from "./http";
import { ensureDir, THUMBS_DIR } from "./paths";

const THUMB_WIDTH = 300;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024; // refuse absurd downloads

/**
 * Logo guard threshold. Outlets set og:image to their logo (UOL "30 anos",
 * "Agora no G1", O Antagonista "oa!") on pages without a photo, and the same
 * bytes came back for hundreds of articles. A genuine wire photo reused
 * inside one outlet topped out at 4 copies in the 2026-09-05 audit, so the
 * fifth identical thumbnail for an outlet is treated as a logo and dropped.
 */
export const THUMB_LOGO_THRESHOLD = Number(process.env.THUMB_LOGO_THRESHOLD ?? 5);

/**
 * Second signal, independent of the count: a logo is a flat graphic. Shannon
 * entropy of the greyscale thumbnail (sharp `stats().entropy`, 0–8 bits)
 * separated the two cleanly in the 2026-09-05 audit — every logo, card and
 * screenshot scored ≤ 3.03 (Veja 2.41, Vermelho 2.79, "Agora no G1" 2.85,
 * UOL 3.03), every photo ≥ 3.15; over 1,000 random live thumbnails the
 * only real photo under 3.1 was a near-black stage shot. Between 3.1 and
 * 4.5 about half are genuine dark photos, so do not raise this casually.
 */
export const THUMB_MIN_ENTROPY = Number(process.env.THUMB_MIN_ENTROPY ?? 3.1);

export function thumbnailHash(processed: Buffer): string {
  return createHash("md5").update(processed).digest("hex");
}

/** True when the processed thumbnail is too flat to be a photo. */
export async function isFlatGraphic(processed: Buffer): Promise<boolean> {
  const { entropy } = await sharp(processed).stats();
  return entropy < THUMB_MIN_ENTROPY;
}

/**
 * Records one more sighting of these thumbnail bytes for the outlet and says
 * whether the image is now considered a logo. Exported so the backfill can
 * warm the table with what is already on disk.
 */
export async function recordThumbnailHash(
  outletId: number,
  hash: string,
  increment = 1,
): Promise<{ seen: number; isLogo: boolean }> {
  const result = await db
    .insert(tables.thumbnailHashes)
    .values({ outletId, hash, seen: increment })
    .onConflictDoUpdate({
      target: [tables.thumbnailHashes.outletId, tables.thumbnailHashes.hash],
      set: {
        seen: sql`${tables.thumbnailHashes.seen} + ${increment}`,
        lastSeenAt: sql`now()`,
      },
    })
    .returning({ seen: tables.thumbnailHashes.seen });
  const seen = result[0]?.seen ?? increment;
  return { seen, isLogo: seen >= THUMB_LOGO_THRESHOLD };
}

/**
 * Re-host, don't hotlink (spec §3.3): download the source image once, resize
 * to ~300px, convert to greyscale server-side, store locally, serve from our
 * domain. The original color image exists only in this function's memory and
 * is never written to disk or retained.
 *
 * Returns the relative path under data/thumbs, or null on any failure —
 * a missing thumbnail must never block article ingestion. Also null when the
 * processed bytes have already been seen THUMB_LOGO_THRESHOLD times for this
 * outlet, or when the image is flatter than THUMB_MIN_ENTROPY (logo guard);
 * the sighting is still counted.
 */
export async function createThumbnail(
  imageUrl: string,
  outlet: { id: number; slug: string },
  articleKey: string,
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(imageUrl, { timeoutMs: 15_000 });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !contentType.startsWith("image/")) return null;
    // Cap enforced while streaming: Content-Length is optional and arrayBuffer()
    // would hold the whole body before any length check (security audit 2026-09-04).
    const original = await readBodyCapped(res, MAX_SOURCE_BYTES);
    if (original.length === 0) return null;

    const processed = await sharp(original)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .greyscale()
      .jpeg({ quality: 70 })
      .toBuffer();

    // Count first so the hash table stays complete even for flat images.
    const { isLogo } = await recordThumbnailHash(outlet.id, thumbnailHash(processed));
    if (isLogo || (await isFlatGraphic(processed))) return null;

    const name = createHash("sha1").update(articleKey).digest("hex").slice(0, 20) + ".jpg";
    const relative = path.join(outlet.slug, name);
    const dir = ensureDir(path.join(THUMBS_DIR, outlet.slug));
    await writeFile(path.join(dir, name), processed);
    return relative;
  } catch {
    return null;
  }
}
