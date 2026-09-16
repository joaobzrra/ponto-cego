import { eq, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { BRIEFING_ENABLED, BRIEFING_LIMIT, briefingLinesFor, parseBriefingLine } from "@/lib/briefing";
import { briefingPrompt } from "@/lib/briefing-prompt";
import { briefingHeads } from "@/lib/home";
import { estimateNovitaUsd, getSpendToday, novitaChat, novitaEnabled, NOVITA_MODEL_ID } from "@/lib/llm";

/*
 * Resumo do dia generation (spec 2026-09-03 §2a). Runs after runClusterCycle.
 *
 * The candidate list is `briefingHeads()` from src/lib/home.ts — the SAME
 * selection the front page renders, hero and Tópicos em Alta already removed.
 * Reproducing the pick here is what made the worker walk the whole day's
 * clusters (57-266 eligible/day measured locally) and pay for stories the
 * Resumo never shows; the page and the worker now cannot disagree.
 *
 * We pay only for a head that has no cached line AND has not already burned a
 * call today (an unparseable answer or a provider error writes an llm_batches
 * row with error_text; retrying it inside the same day just pays twice for the
 * same bad answer — tomorrow is a new day and a new attempt). One paid call
 * each, one llm_batches row each so /admin sees the spend, capped at
 * BRIEFING_LIMIT per cycle and under the daily ceiling like the classifier.
 * BRIEFING_ENABLED=0 skips everything.
 */
export async function runBriefingCycle(): Promise<{ generated: number; skipped: number; usd: number }> {
  const result = { generated: 0, skipped: 0, usd: 0 };
  if (!BRIEFING_ENABLED || !novitaEnabled()) return result;

  const heads = await briefingHeads();
  if (heads.length === 0) return result;

  const cached = await briefingLinesFor(heads.map((h) => h.id));
  // provider_batch_id is `novita-briefing-<clusterId>-<epoch ms>`, so the
  // third dash-separated field is the cluster id.
  const burned = await db.execute(sql`
    select distinct split_part(provider_batch_id, '-', 3)::int as cluster_id
    from llm_batches
    where provider_batch_id like 'novita-briefing-%'
      and submitted_at >= date_trunc('day', now())
      and (status = 'failed' or error_text is not null)
  `);
  const burnedIds = new Set(
    (burned.rows as Array<{ cluster_id: number }>).map((r) => Number(r.cluster_id)),
  );

  const todo = heads
    .filter((h) => !cached.has(h.id) && !burnedIds.has(h.id))
    .slice(0, BRIEFING_LIMIT);
  // A head that already has a cached line is not "skipped" — it is the steady
  // state, and counting it would make the worker log every quiet tick.
  result.skipped += heads.filter((h) => !cached.has(h.id) && burnedIds.has(h.id)).length;

  for (const row of todo) {
    const spend = await getSpendToday();
    if (!spend.underCeiling) {
      result.skipped += 1;
      continue;
    }
    const members = await db.execute(sql`
      select a.title, a.excerpt
      from articles a
      where a.cluster_id = ${Number(row.id)}
        and a.status = 'published' and a.duplicate_of is null
      order by coalesce(a.published_at, a.fetched_at) desc
      limit 5
    `);
    const { system, user } = briefingPrompt({
      title: String(row.title),
      members: (members.rows as Array<{ title: string; excerpt: string | null }>).map((m) => ({
        title: String(m.title),
        excerpt: m.excerpt ?? null,
      })),
    });
    const [batch] = await db
      .insert(tables.llmBatches)
      .values({
        providerBatchId: `novita-briefing-${row.id}-${Date.now()}`,
        modelId: `novita:${NOVITA_MODEL_ID} (briefing)`,
        rubricVersion: 0,
        articleCount: 1,
      })
      .returning();
    try {
      // 120, not 80: the JSON envelope plus a 160-char pt-BR sentence was
      // running out of budget and coming back truncated (unparseable).
      const { raw, usage } = await novitaChat(system, user, 120);
      const usd = estimateNovitaUsd(usage);
      result.usd += usd;
      const line = parseBriefingLine(raw);
      await db
        .update(tables.llmBatches)
        .set({
          status: "ended",
          endedAt: new Date(),
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          estimatedUsd: usd,
          errorText: line ? null : `unparseable: ${raw.slice(0, 120)}`,
        })
        .where(eq(tables.llmBatches.id, batch.id));
      if (!line) {
        result.skipped += 1;
        continue;
      }
      await db
        .insert(tables.briefingLines)
        .values({
          clusterId: Number(row.id),
          line,
          modelId: NOVITA_MODEL_ID,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        })
        .onConflictDoNothing();
      result.generated += 1;
    } catch (err) {
      await db
        .update(tables.llmBatches)
        .set({ status: "failed", endedAt: new Date(), errorText: err instanceof Error ? err.message : String(err) })
        .where(eq(tables.llmBatches.id, batch.id));
      result.skipped += 1;
    }
  }
  return result;
}
