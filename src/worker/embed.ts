/**
 * Embed cycle (stage 5) — fills articles.embedding for published articles.
 * Gated by EMBED_ENABLED=1 in the worker loop; safe to run repeatedly
 * (only touches rows where embedding is null). Backfill of the existing
 * corpus happens through the same path, ~64 at a time.
 */
import { isNull, isNotNull, ne, and, eq, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { embedTexts, embeddingInput } from "@/lib/embeddings";

const BATCH = 64;

export type EmbedCycleResult = {
  embedded: number;
  remaining: number;
  serviceDown: boolean;
};

export async function runEmbedCycle(maxBatches = 8): Promise<EmbedCycleResult> {
  let embedded = 0;
  let serviceDown = false;

  for (let i = 0; i < maxBatches; i++) {
    const rows = await db
      .select({
        id: tables.articles.id,
        title: tables.articles.title,
        excerpt: tables.articles.excerpt,
      })
      .from(tables.articles)
      .where(
        and(
          isNull(tables.articles.embedding),
          eq(tables.articles.status, "published"),
          isNotNull(tables.articles.band),
          ne(tables.articles.band, "NC"),
        ),
      )
      .orderBy(sql`${tables.articles.id} desc`)
      .limit(BATCH);
    if (rows.length === 0) break;

    const vectors = await embedTexts(rows.map(embeddingInput));
    if (!vectors) {
      serviceDown = true;
      break;
    }
    for (let j = 0; j < rows.length; j++) {
      await db
        .update(tables.articles)
        .set({ embedding: vectors[j] })
        .where(eq(tables.articles.id, rows[j].id));
    }
    embedded += rows.length;
  }

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(tables.articles)
    .where(
      and(
        isNull(tables.articles.embedding),
        eq(tables.articles.status, "published"),
        isNotNull(tables.articles.band),
        ne(tables.articles.band, "NC"),
      ),
    );

  return { embedded, remaining: Number(n), serviceDown };
}
