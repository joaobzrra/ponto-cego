/**
 * Stage 4 classifier loop (spec §3.1/§4 + Addendum 01 §A2), cron-driven from
 * the worker tick:
 *   1. Poll open Anthropic batches → apply results, record token spend.
 *   2. If under the daily spend ceiling, gather pending published articles,
 *      fetch their full text transiently (robots-respecting; excerpt fallback
 *      flags low_confidence_input), submit one Message Batch.
 *   3. Execute pending calibration runs (direct calls — small set, admins
 *      want feedback in minutes, not batch latency).
 *
 * Without ANTHROPIC_API_KEY everything here is a log-and-skip no-op.
 */
import { and, desc, eq, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { writeAudit } from "@/lib/audit";
import { buildArticlePrompt, applyClassification } from "@/lib/classification";
import { fetchArticleText } from "@/lib/fulltext";
import {
  CLASSIFY_MODEL_ID,
  NOVITA_MODEL_ID,
  type ClassificationResult,
  classificationParams,
  estimateNovitaUsd,
  estimateUsd,
  getAnthropic,
  getSpendToday,
  novitaClassify,
  novitaEnabled,
  parseClassification,
  ProviderError,
} from "@/lib/llm";
import { getActiveRubric } from "@/lib/rubric";
import { structuredLog } from "@/lib/structured-log";
import { splitByGateSeen } from "./classify-plan";
import { applyGatedNc, NC_GATE_LABEL, ncGateEnabled, partitionByGate } from "./nc-gate";

/** model_id recorded for Novita labels — distinguishable + requeue-able. */
const NOVITA_LABEL = `novita:${NOVITA_MODEL_ID}`;

const BATCH_SIZE = Number(process.env.CLASSIFY_BATCH_SIZE ?? 100);
const FULLTEXT_CONCURRENCY = 4;
/**
 * How many unusable ANSWERS one article may draw before `failed` sticks.
 * Provider outages never reach here — see recordArticleFailure.
 */
const MAX_ATTEMPTS = Number(process.env.CLASSIFY_MAX_ATTEMPTS ?? 3);
/**
 * Articles the NC gate scores per cycle beyond the paid batch. ~51ms each
 * (sequential ONNX, measured on this PC), so 200 ≈ 10s of a classify cycle —
 * and cycles run every CLASSIFY_EVERY_MS (5 min), i.e. ~3% duty. That is
 * ~2,400/h, roughly 17x the ingest rate, so the sweep can never fall behind.
 * 0 disables the sweep without disabling the gate itself.
 */
const GATE_SWEEP_SIZE = Number(process.env.NC_GATE_SWEEP_SIZE ?? 200);

function log(msg: string) {
  structuredLog("info", "classifier", { message: msg });
}

/**
 * An article-level failure: the model answered but the answer was unusable,
 * or its text could not be fetched. Costs one attempt; only the last one is
 * terminal. Anything that is really the provider's fault must NOT come here —
 * pass those up as ProviderError so the cycle aborts with the article still
 * `queued`, to be swept back to `pending` untouched.
 */
async function recordArticleFailure(articleId: number): Promise<{ attempts: number; terminal: boolean }> {
  const [row] = await db
    .update(tables.articles)
    .set({
      classifyAttempts: sql`${tables.articles.classifyAttempts} + 1`,
      classifyStatus: sql`case when ${tables.articles.classifyAttempts} + 1 >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end`,
    })
    .where(eq(tables.articles.id, articleId))
    .returning({ attempts: tables.articles.classifyAttempts, status: tables.articles.classifyStatus });
  return { attempts: row?.attempts ?? 0, terminal: row?.status === "failed" };
}

/**
 * Returns every still-`queued` article of a cycle to `pending`. Called when a
 * cycle aborts mid-flight, so an outage costs a retry rather than the content.
 */
async function releaseQueued(articleIds: number[]): Promise<number> {
  if (articleIds.length === 0) return 0;
  const released = await db
    .update(tables.articles)
    .set({ classifyStatus: "pending" })
    .where(and(inArray(tables.articles.id, articleIds), eq(tables.articles.classifyStatus, "queued")))
    .returning({ id: tables.articles.id });
  return released.length;
}

let warnedNoKey = false;

/**
 * Startup sweep: recover classify state orphaned by a mid-cycle worker death.
 *
 * Novita "batches" are synchronous — the row is bookkeeping for the spend
 * ceiling, not a provider handle — so one left 'submitted' after a restart is
 * dead, and its 'queued' articles would never be reselected (cycles only read
 * 'pending'). Anthropic batches genuinely survive restarts (pollOpenBatches
 * retrieves them by provider id), so those are left untouched. Marking dead
 * novita-* rows failed also keeps pollOpenBatches from asking Anthropic for
 * them when the provider switches back.
 */
export async function sweepOrphanedClassifyState(): Promise<void> {
  const deadBatches = await db
    .update(tables.llmBatches)
    .set({
      status: "failed",
      endedAt: new Date(),
      errorText: "worker morreu no meio do ciclo — varredura de partida devolveu os artigos a pending",
    })
    .where(
      and(eq(tables.llmBatches.status, "submitted"), like(tables.llmBatches.providerBatchId, "novita-%")),
    )
    .returning({ id: tables.llmBatches.id });

  const orphans = await db
    .select({ id: tables.articles.id })
    .from(tables.articles)
    .leftJoin(tables.llmBatches, eq(tables.articles.classifyBatchId, tables.llmBatches.id))
    .where(
      and(
        eq(tables.articles.classifyStatus, "queued"),
        or(isNull(tables.llmBatches.id), ne(tables.llmBatches.status, "submitted")),
      ),
    );

  if (orphans.length > 0) {
    await db
      .update(tables.articles)
      .set({ classifyStatus: "pending" })
      .where(
        inArray(
          tables.articles.id,
          orphans.map((o) => o.id),
        ),
      );
  }

  if (deadBatches.length > 0 || orphans.length > 0) {
    await writeAudit(null, "articles.rescue_orphaned_queued", undefined, {
      articles: orphans.length,
      deadNovitaBatches: deadBatches.map((b) => b.id),
      via: "sweepOrphanedClassifyState (varredura de partida do worker)",
    });
    log(
      `varredura de partida: ${orphans.length} artigos órfãos devolvidos a pending` +
        (deadBatches.length > 0 ? `, ${deadBatches.length} lotes novita mortos marcados failed` : ""),
    );
  }
}

export async function runClassifierCycle(): Promise<void> {
  if (novitaEnabled()) {
    // Interim provider (Marco's Novita credit) — direct calls, no batch API.
    await runPendingCalibration(async (rubric, prompt) => {
      const { parsed } = await novitaClassify(rubric, prompt);
      return parsed;
    }, NOVITA_LABEL);
    await runNovitaCycle();
    return;
  }

  const client = getAnthropic();
  if (!client) {
    if (!warnedNoKey) {
      log("ANTHROPIC_API_KEY ausente — classificação em espera (ativa ao configurar a chave e reiniciar o worker)");
      warnedNoKey = true;
    }
    return;
  }
  await pollOpenBatches(client);
  await runPendingCalibration(async (rubric, prompt) => {
    const message = await client.messages.create(classificationParams(rubric, prompt));
    const textBlock = message.content.find((b) => b.type === "text");
    return textBlock && "text" in textBlock ? parseClassification(textBlock.text) : null;
  }, CLASSIFY_MODEL_ID);
  await submitNextBatch(client);
}

/**
 * Novita path: same gather → transient full text → rubric prompt as the
 * batch path, but direct calls with bounded concurrency, applied as they
 * land. One llm_batches row per cycle keeps the shared daily USD ceiling
 * accounting intact (Novita spends Marco's balance, the ceiling still
 * guards runaway volume).
 */
/**
 * Per-outlet UA overrides for the transient full-text fetch (outlets whose
 * WAF rejects the identifying bot UA while robots.txt allows crawling).
 */
async function outletUaMap(): Promise<Map<number, string>> {
  const rows = await db
    .select({ id: tables.outlets.id, ua: tables.outlets.fetchUserAgent })
    .from(tables.outlets);
  return new Map(rows.filter((r): r is { id: number; ua: string } => !!r.ua).map((r) => [r.id, r.ua]));
}

/**
 * Walk the NC gate forward over pending articles the paid path has not reached.
 *
 * Why this is a separate pass: the paid cycle only ever selects the oldest
 * BATCH_SIZE pending rows. Those rows keep their `classify_batch_id` when an
 * outage releases them back to `pending`, so on 2026-07-24 the cycle re-selected
 * the same already-gated 300 articles (ids 47782–48432) every 30s for ~40h while
 * 2,209 never-gated rows (48433+) sat behind them and the gate scored nothing.
 *
 * The gate is local, free and independent of the provider, so it has no reason
 * to wait on balance. Survivors are marked with this sweep's batch id, which is
 * what makes the sweep advance instead of rescoring the same rows forever.
 */
async function runGateSweep(rubricVersion: number): Promise<void> {
  if (!ncGateEnabled() || GATE_SWEEP_SIZE <= 0) return;

  const rows = await db
    .select({
      id: tables.articles.id,
      title: tables.articles.title,
      excerpt: tables.articles.excerpt,
    })
    .from(tables.articles)
    .where(
      and(eq(tables.articles.classifyStatus, "pending"), isNull(tables.articles.classifyBatchId)),
    )
    // Newest first (owner ruling 2026-09-02): the public 24h/48h windows must
    // fill before the pre-launch backlog, which drains with leftover budget.
    .orderBy(desc(tables.articles.id))
    .limit(GATE_SWEEP_SIZE);
  if (rows.length === 0) return;

  const { skip, keep, ran } = await partitionByGate(rows);
  // Fail-open result: the gate never actually scored these. Marking them now
  // would exempt them from the gate permanently — leave them for the next tick.
  if (!ran) return;

  const [batch] = await db
    .insert(tables.llmBatches)
    .values({
      providerBatchId: `ncgate-${Date.now()}`,
      modelId: NC_GATE_LABEL,
      rubricVersion,
      articleCount: rows.length,
      status: "ended",
      endedAt: new Date(),
      inputTokens: 0,
      outputTokens: 0,
      estimatedUsd: 0,
    })
    .returning();

  for (const g of skip) {
    await applyGatedNc(g.article.id, g.pNc, { rubricVersion, batchId: batch.id });
  }
  if (keep.length > 0) {
    await db
      .update(tables.articles)
      .set({ classifyBatchId: batch.id })
      .where(
        inArray(
          tables.articles.id,
          keep.map((a) => a.id),
        ),
      );
  }

  log(
    `portão NC varredura #${batch.id}: ${rows.length} varridos — ${skip.length} rotulados NC (grátis), ` +
      `${keep.length} marcados para o modelo pago`,
  );
}

async function runNovitaCycle(): Promise<void> {
  const rubric = await getActiveRubric();
  if (!rubric) {
    log("nenhuma rubrica ativa — pulando ciclo");
    return;
  }

  // Local and free, so it runs BEFORE the spend ceiling and provider checks:
  // neither an exhausted balance nor a hit ceiling should stall the gate.
  await runGateSweep(rubric.version);

  const spend = await getSpendToday();
  if (!spend.underCeiling) {
    log(
      `teto diário atingido (US$${spend.todayUsd.toFixed(2)} >= US$${spend.ceilingUsd}) — classificação pausada até amanhã`,
    );
    return;
  }

  const pending = await db
    .select()
    .from(tables.articles)
    .where(eq(tables.articles.classifyStatus, "pending"))
    // Newest first (owner ruling 2026-09-02): the public 24h/48h windows must
    // fill before the pre-launch backlog, which drains with leftover budget.
    .orderBy(desc(tables.articles.id))
    .limit(BATCH_SIZE);
  if (pending.length === 0) return;

  // NC pre-gate: label the confidently non-political locally, skipping the paid
  // model AND the full-text fetch. Fail-safe — a disabled or erroring gate keeps
  // every article for the paid model (see nc-gate.ts). Rows the sweep already
  // scored carry a batch id and must NOT be scored a second time.
  const { gateSeen, needsGate } = splitByGateSeen(pending);
  const { skip: gatedNc, keep } = await partitionByGate(needsGate);
  for (const g of gatedNc) {
    await applyGatedNc(g.article.id, g.pNc, { rubricVersion: rubric.version, batchId: null });
  }
  const toClassify = [...gateSeen, ...keep];
  if (toClassify.length === 0) {
    if (gatedNc.length > 0) {
      log(`novita ciclo: ${gatedNc.length} pré-classificados NC pelo portão, nenhum para o modelo pago`);
    }
    return;
  }

  const [batch] = await db
    .insert(tables.llmBatches)
    .values({
      providerBatchId: `novita-${Date.now()}`,
      modelId: NOVITA_LABEL,
      rubricVersion: rubric.version,
      articleCount: toClassify.length,
    })
    .returning();
  await db
    .update(tables.articles)
    .set({ classifyStatus: "queued", classifyBatchId: batch.id })
    .where(
      inArray(
        tables.articles.id,
        toClassify.map((a) => a.id),
      ),
    );

  let applied = 0;
  let retried = 0;
  let exhausted = 0;
  const usage = { input_tokens: 0, output_tokens: 0 };
  const lowConfidenceIds: number[] = [];
  const queue = [...toClassify];
  const uaOverrides = await outletUaMap();
  /**
   * First provider-level refusal seen this cycle. Set once, it drains every
   * worker: replaying a 403 across the remaining articles produced 2,730
   * identical log lines on 2026-07-20 and told us nothing the first one didn't.
   */
  const outageRef: { current: ProviderError | null } = { current: null };

  await Promise.all(
    Array.from({ length: Math.min(FULLTEXT_CONCURRENCY, queue.length) }, async () => {
      for (let article = queue.shift(); article && !outageRef.current; article = queue.shift()) {
        try {
          const fullText = await fetchArticleText(article.canonicalUrl, {
            userAgent: uaOverrides.get(article.outletId),
          });
          const { prompt, lowConfidence } = buildArticlePrompt(article, fullText);
          if (lowConfidence) lowConfidenceIds.push(article.id);
          const result = await novitaClassify(rubric.content, prompt);
          usage.input_tokens += result.usage.input_tokens;
          usage.output_tokens += result.usage.output_tokens;
          if (result.parsed) {
            await applyClassification(article.id, result.parsed, {
              rubricVersion: rubric.version,
              modelId: NOVITA_LABEL,
              batchId: batch.id,
            });
            applied++;
          } else {
            const { attempts, terminal } = await recordArticleFailure(article.id);
            if (terminal) exhausted++;
            else retried++;
            log(
              `novita artigo #${article.id} sem JSON válido (tentativa ${attempts}/${MAX_ATTEMPTS}` +
                `${terminal ? ", desistindo" : ", devolvido a pending"}) — resposta crua: ${result.raw.slice(0, 200) || "(vazia)"}`,
            );
          }
        } catch (err) {
          if (err instanceof ProviderError && err.isOutage) {
            // Leave the article `queued`; the sweep below returns it to pending.
            outageRef.current ??= err;
            break;
          }
          const { attempts, terminal } = await recordArticleFailure(article.id);
          if (terminal) exhausted++;
          else retried++;
          log(
            `novita artigo #${article.id} falhou (tentativa ${attempts}/${MAX_ATTEMPTS}` +
              `${terminal ? ", desistindo" : ", devolvido a pending"}) — ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }),
  );

  const outage = outageRef.current;
  const releasedCount = outage ? await releaseQueued(toClassify.map((a) => a.id)) : 0;

  if (lowConfidenceIds.length > 0) {
    await db
      .update(tables.articles)
      .set({ lowConfidenceInput: true })
      .where(inArray(tables.articles.id, lowConfidenceIds));
  }

  const estimatedUsdTotal = estimateNovitaUsd(usage);
  await db
    .update(tables.llmBatches)
    .set({
      status: "ended",
      endedAt: new Date(),
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      estimatedUsd: estimatedUsdTotal,
      // Surfaces the real cause in /admin instead of a silent all-zero batch.
      errorText: outage ? outage.message : null,
    })
    .where(eq(tables.llmBatches.id, batch.id));

  if (outage) {
    log(
      `novita ciclo #${batch.id} ABORTADO — provedor indisponível (${outage.status}): ${outage.body}. ` +
        `${applied} classificados antes da falha, ${releasedCount} artigos devolvidos a pending (nenhum perdido).` +
        (outage.needsHuman
          ? " AÇÃO NECESSÁRIA: saldo/credencial do provedor — a classificação fica parada até isso ser resolvido."
          : " Nova tentativa no próximo ciclo."),
    );
    return;
  }

  log(
    `novita ciclo #${batch.id}: ${applied} classificados, ${gatedNc.length} NC-portão, ${retried} reagendados, ${exhausted} desistidos, ` +
      `~US$${estimatedUsdTotal.toFixed(3)} (${NOVITA_LABEL}, rubrica v${rubric.version})`,
  );
}

async function pollOpenBatches(client: NonNullable<ReturnType<typeof getAnthropic>>) {
  const open = await db
    .select()
    .from(tables.llmBatches)
    .where(eq(tables.llmBatches.status, "submitted"));

  for (const batch of open) {
    try {
      const remote = await client.messages.batches.retrieve(batch.providerBatchId);
      if (remote.processing_status !== "ended") continue;

      let applied = 0;
      let retried = 0;
      let exhausted = 0;
      let released = 0;
      const usageTotals = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };

      for await (const entry of await client.messages.batches.results(batch.providerBatchId)) {
        const articleId = Number(entry.custom_id.replace("article-", ""));
        // Expired/canceled batches were never judged — same reasoning as a
        // Novita outage: return the article untouched, cost it no attempt.
        if (entry.result.type === "expired" || entry.result.type === "canceled") {
          released += await releaseQueued([articleId]);
          continue;
        }
        if (entry.result.type === "succeeded") {
          const message = entry.result.message;
          usageTotals.input += message.usage.input_tokens;
          usageTotals.output += message.usage.output_tokens;
          usageTotals.cacheCreate += message.usage.cache_creation_input_tokens ?? 0;
          usageTotals.cacheRead += message.usage.cache_read_input_tokens ?? 0;
          const textBlock = message.content.find((b) => b.type === "text");
          const parsed = textBlock && "text" in textBlock ? parseClassification(textBlock.text) : null;
          if (parsed) {
            await applyClassification(articleId, parsed, {
              rubricVersion: batch.rubricVersion,
              modelId: batch.modelId,
              batchId: batch.id,
            });
            applied++;
            continue;
          }
        }
        const { terminal } = await recordArticleFailure(articleId);
        if (terminal) exhausted++;
        else retried++;
      }

      const estimatedUsdTotal = estimateUsd({
        input_tokens: usageTotals.input,
        output_tokens: usageTotals.output,
        cache_creation_input_tokens: usageTotals.cacheCreate,
        cache_read_input_tokens: usageTotals.cacheRead,
      });
      await db
        .update(tables.llmBatches)
        .set({
          status: "ended",
          endedAt: new Date(),
          inputTokens: usageTotals.input,
          outputTokens: usageTotals.output,
          cacheCreationTokens: usageTotals.cacheCreate,
          cacheReadTokens: usageTotals.cacheRead,
          estimatedUsd: estimatedUsdTotal,
        })
        .where(eq(tables.llmBatches.id, batch.id));
      log(
        `batch #${batch.id} concluído: ${applied} classificados, ${retried} reagendados, ${exhausted} desistidos, ` +
          `${released} devolvidos a pending, ~US$${estimatedUsdTotal.toFixed(3)}`,
      );
    } catch (err) {
      log(`batch #${batch.id} poll falhou — ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function submitNextBatch(client: NonNullable<ReturnType<typeof getAnthropic>>) {
  // One batch in flight at a time keeps spend accounting simple and is plenty
  // of throughput at MVP volume.
  const [inFlight] = await db
    .select({ id: tables.llmBatches.id })
    .from(tables.llmBatches)
    .where(eq(tables.llmBatches.status, "submitted"))
    .limit(1);
  if (inFlight) return;

  const spend = await getSpendToday();
  if (!spend.underCeiling) {
    log(
      `teto diário atingido (US$${spend.todayUsd.toFixed(2)} >= US$${spend.ceilingUsd}) — classificação pausada até amanhã`,
    );
    return;
  }

  const pending = await db
    .select()
    .from(tables.articles)
    .where(eq(tables.articles.classifyStatus, "pending"))
    // Newest first (owner ruling 2026-09-02): the public 24h/48h windows must
    // fill before the pre-launch backlog, which drains with leftover budget.
    .orderBy(desc(tables.articles.id))
    .limit(BATCH_SIZE);
  if (pending.length === 0) return;

  const rubric = await getActiveRubric();
  if (!rubric) {
    log("nenhuma rubrica ativa — pulando ciclo");
    return;
  }

  // NC pre-gate before spending Haiku tokens; fail-safe keeps everything.
  const { skip: gatedNc, keep } = await partitionByGate(pending);
  for (const g of gatedNc) {
    await applyGatedNc(g.article.id, g.pNc, { rubricVersion: rubric.version, batchId: null });
  }
  if (keep.length === 0) {
    if (gatedNc.length > 0) log(`${gatedNc.length} pré-classificados NC pelo portão, nenhum para o modelo pago`);
    return;
  }

  // Transient full-text fetch, bounded concurrency; never stored.
  const prompts = new Map<number, { prompt: string; lowConfidence: boolean }>();
  const queue = [...keep];
  const uaOverrides = await outletUaMap();
  await Promise.all(
    Array.from({ length: Math.min(FULLTEXT_CONCURRENCY, queue.length) }, async () => {
      for (let article = queue.shift(); article; article = queue.shift()) {
        const fullText = await fetchArticleText(article.canonicalUrl, {
          userAgent: uaOverrides.get(article.outletId),
        });
        prompts.set(article.id, buildArticlePrompt(article, fullText));
      }
    }),
  );

  const requests = keep.map((article) => ({
    custom_id: `article-${article.id}`,
    params: classificationParams(rubric.content, prompts.get(article.id)!.prompt),
  }));

  try {
    const remote = await client.messages.batches.create({ requests });
    const [batch] = await db
      .insert(tables.llmBatches)
      .values({
        providerBatchId: remote.id,
        modelId: CLASSIFY_MODEL_ID,
        rubricVersion: rubric.version,
        articleCount: keep.length,
      })
      .returning();
    await db
      .update(tables.articles)
      .set({ classifyStatus: "queued", classifyBatchId: batch.id })
      .where(
        inArray(
          tables.articles.id,
          keep.map((a) => a.id),
        ),
      );
    // Full text unavailable → the model saw only title+excerpt. Flag durably
    // at submit time (survives worker restarts mid-batch).
    const lowConfidenceIds = keep
      .filter((a) => prompts.get(a.id)!.lowConfidence)
      .map((a) => a.id);
    if (lowConfidenceIds.length > 0) {
      await db
        .update(tables.articles)
        .set({ lowConfidenceInput: true })
        .where(inArray(tables.articles.id, lowConfidenceIds));
    }
    log(
      `batch #${batch.id} enviado: ${keep.length} artigos` +
        (gatedNc.length > 0 ? `, ${gatedNc.length} NC-portão` : "") +
        ` (rubrica v${rubric.version}, ${CLASSIFY_MODEL_ID})`,
    );
  } catch (err) {
    log(`envio de batch falhou — ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Calibration runs (spec §5 + Addendum §A2): direct (non-batch) calls so the
 * admin sees agreement within minutes. Reports NC agreement separately.
 * Provider-agnostic: `classifyOnce` is whatever the ACTIVE classifier is, so
 * calibration always measures the model that is actually labeling.
 */
async function runPendingCalibration(
  classifyOnce: (rubricContent: string, prompt: string) => Promise<ClassificationResult | null>,
  modelId: string,
) {
  const [run] = await db
    .select()
    .from(tables.calibrationRuns)
    .where(eq(tables.calibrationRuns.status, "pending"))
    .limit(1);
  if (!run) return;

  const rubric = await getActiveRubric();
  if (!rubric) return;
  await db
    .update(tables.calibrationRuns)
    .set({ status: "running", startedAt: new Date(), rubricVersion: rubric.version, modelId })
    .where(eq(tables.calibrationRuns.id, run.id));

  try {
    const set = await db.select().from(tables.calibrationArticles);
    const results: Array<Record<string, unknown>> = [];
    let agreed = 0;
    let ncTotal = 0;
    let ncAgreed = 0;
    let fetchFailed = 0;

    for (const item of set) {
      const fullText = await fetchArticleText(item.url);
      if (!fullText) fetchFailed++;
      const { prompt } = buildArticlePrompt(
        { title: item.title, excerpt: "", canonicalUrl: item.url, feedScope: "geral" },
        fullText,
      );
      const parsed = await classifyOnce(rubric.content, prompt);

      const got = parsed?.band ?? "PARSE_FAIL";
      const isAgreed = got === item.expectedBand;
      if (isAgreed) agreed++;
      if (item.expectedBand === "NC") {
        ncTotal++;
        if (isAgreed) ncAgreed++;
      }
      results.push({
        calibrationArticleId: item.id,
        title: item.title,
        expected: item.expectedBand,
        got,
        confidence: parsed?.confidence ?? null,
        fetchOk: !!fullText,
      });
    }

    await db
      .update(tables.calibrationRuns)
      .set({
        status: "done",
        finishedAt: new Date(),
        total: set.length,
        agreed,
        ncTotal,
        ncAgreed,
        fetchFailed,
        results,
      })
      .where(eq(tables.calibrationRuns.id, run.id));
    log(
      `calibração #${run.id}: ${agreed}/${set.length} concordância geral, ${ncAgreed}/${ncTotal} NC, ${fetchFailed} fetch falhas`,
    );
  } catch (err) {
    await db
      .update(tables.calibrationRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorText: err instanceof Error ? err.message : String(err),
      })
      .where(eq(tables.calibrationRuns.id, run.id));
    log(`calibração #${run.id} falhou — ${err instanceof Error ? err.message : err}`);
  }
}
