/**
 * NC pre-gate (deploy 2026-07-22). A local BERTimbau binary classifier
 * (politica|nc) runs BEFORE the paid model: articles it is confident are
 * non-political are labeled NC on the spot, skipping both the full-text fetch
 * and the paid classification call. Re-evaluated against a held-out v4 set
 * (ROC-AUC 0.94); at threshold 0.05 it removes ~44% of paid calls with true
 * political leakage <1% (see memory nc-gate-reevaluation).
 *
 * Runs as ONNX via @huggingface/transformers — no Python in prod, CPU-viable
 * for the August VPS. The model is scored on `title\nexcerpt`, exactly the
 * input it was trained on (scripts/export-nc-dataset.ts).
 *
 * FAIL-SAFE BY DESIGN: disabled by default (NC_GATE_ENABLED unset), and any
 * load/scoring error degrades to "keep everything" — the gate can only ever
 * REMOVE work for the paid model, never block classification.
 */
import { eq, sql } from "drizzle-orm";
import { db, tables } from "@/db";

type GateArticle = { id: number; title: string; excerpt: string | null };

const ENABLED = process.env.NC_GATE_ENABLED === "1";
/** Skip the paid model when P(politica) < threshold. 0.05 ≈ 44% fewer paid
 * calls at <1% true leakage; 0.02 is the conservative ~1% option. */
const THRESHOLD = Number(process.env.NC_GATE_THRESHOLD ?? 0.05);
/** Base dir that CONTAINS the model folder; forward slashes for Transformers.js. */
const MODEL_BASE = (process.env.NC_GATE_MODEL_BASE ?? "E:/ml/nc-gate").replace(/\\/g, "/");
const MODEL_ID = process.env.NC_GATE_MODEL_ID ?? "model-v1";

/** model_id recorded for gate-applied NC labels — distinguishable + requeue-able. */
export const NC_GATE_LABEL = `nc-gate:${MODEL_ID}`;

export function ncGateEnabled(): boolean {
  return ENABLED;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipePromise: Promise<any> | null = null;

async function getPipe() {
  if (!pipePromise) {
    pipePromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowRemoteModels = false; // never phone home; local ONNX only
      env.localModelPath = MODEL_BASE;
      return pipeline("text-classification", MODEL_ID, { dtype: "fp32" });
    })();
  }
  return pipePromise;
}

/** P(politica) ∈ [0,1] for one article. Higher = more likely political. */
async function scorePolitica(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipe: any,
  title: string,
  excerpt: string | null,
): Promise<number> {
  const text = `${title}\n${excerpt ?? ""}`.trim().slice(0, 2000);
  const out = (await pipe(text, { top_k: 2 })) as Array<{ label: string; score: number }>;
  const pol = out.find((o) => o.label === "politica");
  return pol?.score ?? 0;
}

/**
 * `ran` distinguishes "the gate scored these and kept them" from "the gate was
 * off or broken, so everything defaults to keep". Callers that PERSIST a
 * gate-seen mark must check it — treating a fail-open result as a real pass
 * would permanently exempt those articles from the gate.
 */
export type GatePartition<T> = { skip: Array<{ article: T; pNc: number }>; keep: T[]; ran: boolean };

/**
 * Split a cycle's articles into the ones the gate confidently calls NC (skip
 * the paid model) and the ones to classify normally. Fail-safe: if the gate is
 * disabled, empty, or errors, EVERYTHING lands in `keep` with `ran: false`.
 */
export async function partitionByGate<T extends GateArticle>(articles: T[]): Promise<GatePartition<T>> {
  if (!ENABLED || articles.length === 0) return { skip: [], keep: articles, ran: false };
  try {
    const pipe = await getPipe();
    const skip: Array<{ article: T; pNc: number }> = [];
    const keep: T[] = [];
    for (const a of articles) {
      const pPol = await scorePolitica(pipe, a.title, a.excerpt);
      if (pPol < THRESHOLD) skip.push({ article: a, pNc: 1 - pPol });
      else keep.push(a);
    }
    return { skip, keep, ran: true };
  } catch (err) {
    console.log(
      `[${new Date().toISOString()}] nc-gate: desativado neste ciclo (erro ao carregar/pontuar) — ` +
        `todos os artigos seguem para o modelo pago: ${err instanceof Error ? err.message : err}`,
    );
    return { skip: [], keep: articles, ran: false };
  }
}

/**
 * Writes a gate-decided NC label. Same shape as applyClassification but no paid
 * call, a distinct model_id, and confidence = P(nc). NC carries no band-spectrum
 * weight, so category/keywords stay empty.
 */
export async function applyGatedNc(
  articleId: number,
  pNc: number,
  meta: { rubricVersion: number; batchId: number | null },
): Promise<void> {
  const activatedAt = new Date();
  const reason =
    "Pré-portão NC (BERTimbau local): sem dimensão política detectada — classificação paga dispensada.";
  await db.transaction(async (tx) => {
    await tx.insert(tables.classificationObservations).values({
      articleId,
      batchId: meta.batchId,
      provider: "local",
      modelId: NC_GATE_LABEL,
      rubricVersion: meta.rubricVersion,
      promptVersion: process.env.NC_GATE_MODEL_VERSION ?? "v1",
      band: "NC",
      confidence: pNc,
      keywords: [],
      category: null,
      reason,
      activatedAt,
    });
    await tx
      .update(tables.articles)
      .set({
        band: "NC",
        bandConfidence: pNc,
        keywords: [],
        category: null,
        classifyReason: reason,
        rubricVersion: meta.rubricVersion,
        modelId: NC_GATE_LABEL,
        classifiedAt: activatedAt,
        classifyStatus: "classified",
        classifyBatchId: meta.batchId,
        classifyAttempts: sql`${tables.articles.classifyAttempts}`,
      })
      .where(eq(tables.articles.id, articleId));
  });
}
