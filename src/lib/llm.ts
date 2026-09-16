/**
 * Thin internal LLM client (spec §4): wraps the Anthropic SDK with the
 * project's rules baked in — Batch API for volume work, prompt caching on the
 * rubric, model IDs pinned from config, structured output parsing, and a
 * per-day spend ceiling computed from recorded batch usage.
 *
 * When ANTHROPIC_API_KEY is unset the client is null and callers log-and-skip
 * (same pattern as the mailer) — the pipeline activates the moment the key
 * lands in .env and the worker restarts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { gte, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { BANDS, type Band } from "@/db/schema";

export const CLASSIFY_MODEL_ID = process.env.CLASSIFY_MODEL_ID ?? "claude-haiku-4-5-20251001";
export const DAILY_USD_CEILING = Number(process.env.CLASSIFY_DAILY_USD_CEILING ?? 6);

/*
 * Alternate provider (2026-07-11): Novita (OpenAI-compatible, open models),
 * funded by Marco while the Anthropic account is out of credit. Interim by
 * design: articles it labels carry model_id "novita:<model>" so they are
 * queryable (model_id LIKE 'novita:%') and get RECLASSIFIED under Haiku when
 * API access returns (see OPUS-HANDOFF). Provider switch is env-only:
 * CLASSIFY_PROVIDER=novita activates it; unset/anything else = Anthropic.
 */
export const CLASSIFY_PROVIDER = process.env.CLASSIFY_PROVIDER ?? "anthropic";
export const NOVITA_MODEL_ID = process.env.NOVITA_MODEL_ID ?? "deepseek/deepseek-v3.2";
const NOVITA_URL =
  process.env.NOVITA_URL ?? "https://api.novita.ai/v3/openai/chat/completions";
const NOVITA_TIMEOUT_MS = 90_000;

/*
 * Sampling temperature for CLASSIFICATION only.
 *
 * Until 2026-09-04 no temperature was sent, so the band was drawn from the
 * provider default rather than decided. Measured on 5 repeat runs of the same
 * article under the same rubric v4: 4 of 5 articles returned more than one
 * band, and article 43227 ("Flávio nunca foi um moderado") returned E3 three
 * times, E2 once and D3 once — the full width of the spectrum — reporting
 * 0.85-0.95 confidence every time. The identical syndicated column stored E3
 * at Folha (43215) and D3 at UOL (43227) was that same dice roll, not an
 * outlet effect.
 *
 * A bias verdict must be a property of the text, not of the sample. 0 is the
 * right default here; raise it only with a measurement that says so.
 */
const NOVITA_CLASSIFY_TEMPERATURE = Number(process.env.NOVITA_CLASSIFY_TEMPERATURE ?? 0);
/**
 * Novita list prices per MTok for the pinned model — env-overridable.
 * Verified against novita.ai/pricing 2026-07-21 for deepseek-v3.2:
 * input $0.269, output $0.40, cache-read $0.1345. The previous defaults
 * (0.3 / 1.2) overstated OUTPUT by 3x, which inflated estimated_usd ~18% and
 * tripped CLASSIFY_DAILY_USD_CEILING early — pausing classification against
 * money that had not actually been spent.
 *
 * Note this still bills every input token at the uncached rate, so the
 * estimate remains CONSERVATIVE where Novita caches the fixed rubric.
 */
const NOVITA_INPUT_USD_PER_MTOK = Number(process.env.NOVITA_INPUT_USD_PER_MTOK ?? 0.269);
const NOVITA_OUTPUT_USD_PER_MTOK = Number(process.env.NOVITA_OUTPUT_USD_PER_MTOK ?? 0.4);

export function novitaEnabled(): boolean {
  return CLASSIFY_PROVIDER === "novita" && !!process.env.NOVITA_API_KEY;
}

/**
 * A provider-side refusal, as opposed to a bad answer about one article.
 * The distinction is the whole point: an article that hit a 403 or a 429 was
 * never actually judged, so burning its retry budget (or worse, marking it
 * permanently `failed`) loses content to an accounting problem. The Novita
 * balance outage of 2026-07-20 stranded 2,761 articles exactly this way.
 */
export class ProviderError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`novita ${status}: ${body}`);
    this.name = "ProviderError";
  }

  /**
   * True when the whole provider is unusable right now, so the cycle should
   * stop rather than replay the same error once per article. Auth/billing
   * (401/402/403) need a human; 429 and 5xx need time.
   */
  get isOutage(): boolean {
    return this.status === 401 || this.status === 402 || this.status === 403 || this.status === 429 || this.status >= 500;
  }

  /** Balance/auth specifically — no amount of waiting fixes these. */
  get needsHuman(): boolean {
    return this.status === 401 || this.status === 402 || this.status === 403;
  }
}

/** Haiku 4.5 list prices per MTok; overridable when the pinned model changes. */
const INPUT_USD_PER_MTOK = Number(process.env.CLASSIFY_INPUT_USD_PER_MTOK ?? 1);
const OUTPUT_USD_PER_MTOK = Number(process.env.CLASSIFY_OUTPUT_USD_PER_MTOK ?? 5);
/** Batch API halves the price. */
const BATCH_DISCOUNT = 0.5;

let cachedClient: Anthropic | null | undefined;

export function getAnthropic(): Anthropic | null {
  if (cachedClient !== undefined) return cachedClient;
  const key = process.env.ANTHROPIC_API_KEY;
  cachedClient = key ? new Anthropic({ apiKey: key }) : null;
  return cachedClient;
}

/** Fixed category taxonomy (user-approved 2026-07-10; rubric v4 emits it). */
export const CATEGORIES = [
  "Política Nacional",
  "Economia",
  "Geopolítica",
  "Justiça e Segurança",
  "Religião",
  "Saúde",
  "Educação",
  "Meio Ambiente",
  "Cultura",
  "Esportes",
  "Outro",
] as const;

/** JSON schema for the structured classification result (Addendum 01 §A2). */
export const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    band: { type: "string", enum: [...BANDS] },
    confidence: { type: "number" },
    reason: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    category: { type: "string", enum: [...CATEGORIES] },
  },
  required: ["band", "confidence", "reason", "keywords", "category"],
  additionalProperties: false,
} as const;

export type ClassificationResult = {
  band: Band;
  confidence: number;
  reason: string;
  keywords: string[];
  /** null when the model omitted it or emitted something off-taxonomy. */
  category: string | null;
};

/**
 * DeepSeek pollutes specifically the confidence field while band/reason stay
 * valid — observed shapes: ", 1.0", "?", "></confidence> 1.0", "0,9",
 * nested objects like {"value": 0.9}, per-band distributions
 * {"NC": 0.95, "E3": 0.01, ...}, arrays ([1,0], ["1.0"], even a URL) and
 * empty strings. Salvage a plausible probability when one is recoverable
 * (never store NaN: it survives the Math clamp, lands in Postgres real,
 * poisons avg() and renders as "NaN%"); null rejects the response so the
 * article retries. Values from strings/arrays/objects must land in [0, 1] —
 * stray digits (URLs, dates) must not clamp into a fake 1.0.
 */
function coerceConfidence(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    // ",9" / ".85": bare decimal with the leading zero dropped — unambiguous.
    const bare = v.trim().match(/^[.,](\d+)$/);
    if (bare) return Number(`0.${bare[1]}`);
    const m = v.match(/\d+(?:[.,]\d+)?/);
    if (!m) return null;
    const n = Number(m[0].replace(",", "."));
    return n >= 0 && n <= 1 ? n : null;
  }
  if (Array.isArray(v)) {
    // [1,0] / ["1.0"] style: highest in-range entry is the model's pick.
    const nums = v.map(coerceConfidence).filter((n): n is number => n !== null);
    return nums.length > 0 ? Math.max(...nums) : null;
  }
  if (v && typeof v === "object") {
    const nested = v as Record<string, unknown>;
    if ("value" in nested) return coerceConfidence(nested.value);
    if ("confidence" in nested) return coerceConfidence(nested.confidence);
    // Per-band distribution: the max entry is the chosen band's confidence.
    const values = Object.values(nested)
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1);
    return values.length > 0 ? Math.max(...values) : null;
  }
  return null;
}

/** Off-taxonomy strings become null — never invent a category. */
function coerceCategory(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const hit = CATEGORIES.find((c) => c.localeCompare(s, "pt", { sensitivity: "base" }) === 0);
  return hit ?? null;
}

export function parseClassification(raw: string): ClassificationResult | null {
  try {
    // Open models sometimes fence the JSON despite instructions.
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const band = parsed.band as string;
    if (!BANDS.includes(band as Band)) return null;
    const confidence = coerceConfidence(parsed.confidence);
    if (confidence === null) return null;
    return {
      band: band as Band,
      // Round to 4 places: DeepSeek once returned 5.5e-320, which is in range
      // but underflows Postgres `real` and rejects the whole observation row.
      confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 1e4) / 1e4,
      reason: String(parsed.reason ?? "").slice(0, 500),
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.map(String).slice(0, 8)
        : [],
      category: coerceCategory(parsed.category),
    };
  } catch {
    return null;
  }
}

/** Request params shared by batch requests and direct calibration calls. */
export function classificationParams(rubricContent: string, userPrompt: string) {
  return {
    model: CLASSIFY_MODEL_ID,
    max_tokens: 1024,
    system: [
      {
        type: "text" as const,
        text: rubricContent,
        // The rubric is identical across every request in a batch — cache it.
        cache_control: { type: "ephemeral" as const },
      },
    ],
    output_config: {
      format: {
        type: "json_schema" as const,
        schema: CLASSIFICATION_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    messages: [{ role: "user" as const, content: userPrompt }],
  };
}

export type SpendSummary = { todayUsd: number; ceilingUsd: number; underCeiling: boolean };

/** Spend ceiling (spec §4): sum of estimated USD across today's batches. */
export async function getSpendToday(): Promise<SpendSummary> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ usd: sql<number>`coalesce(sum(${tables.llmBatches.estimatedUsd}), 0)` })
    .from(tables.llmBatches)
    .where(gte(tables.llmBatches.submittedAt, startOfDay));
  const todayUsd = Number(row.usd);
  return { todayUsd, ceilingUsd: DAILY_USD_CEILING, underCeiling: todayUsd < DAILY_USD_CEILING };
}

export type NovitaUsage = { input_tokens: number; output_tokens: number };

/**
 * Client-side pacing for Novita's account rate limit (observed 2026-07-21:
 * `429 RATE_LIMIT_EXCEEDED ... current limit 30 requests per minute`).
 *
 * Without this the cycle sprints through FULLTEXT_CONCURRENCY parallel calls,
 * trips 429 after ~29 articles and aborts — correct, but it caps throughput at
 * ~30 per cycle, far too slow to drain a backlog. Pacing to just under the
 * limit turns the same budget into steady progress instead of a stall.
 *
 * Slot reservation is a single synchronous read-modify-write, so concurrent
 * callers each get a distinct slot without a mutex (JS runs it to completion).
 */
const NOVITA_MIN_INTERVAL_MS = Number(process.env.NOVITA_MIN_INTERVAL_MS ?? 2200);
let nextSlotAt = 0;

async function awaitRateLimitSlot(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + NOVITA_MIN_INTERVAL_MS;
  const wait = slot - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/**
 * Which structured-output contract to send on the OpenAI-compatible path.
 *
 * These providers do NOT agree, and picking wrong is a hard 400 on every call:
 *   json_object — OpenAI, DeepInfra, Groq. What this code has always sent.
 *   json_schema — Novita's ONLY documented format
 *                 (novita.ai/docs/guides/llm-structured-outputs, checked
 *                 2026-07-21). Novita nonetheless accepts json_object most of
 *                 the time, which is why ~25k articles classified fine while a
 *                 steady ~2%/day died on
 *                 `400 response format json_object is not supported` — support
 *                 is undocumented and evidently best-effort per backend.
 *
 * Default stays json_object so behaviour is unchanged until deliberately
 * switched. Set NOVITA_RESPONSE_FORMAT=json_schema when pointing at Novita.
 * parseClassification validates the reply either way, so a provider that
 * ignores the hint costs a retry, never a bad band.
 */
export const NOVITA_RESPONSE_FORMAT = process.env.NOVITA_RESPONSE_FORMAT ?? "json_object";

export function novitaResponseFormat(): Record<string, unknown> {
  if (NOVITA_RESPONSE_FORMAT === "json_schema") {
    return {
      type: "json_schema",
      json_schema: {
        name: "classificacao",
        strict: true,
        schema: CLASSIFICATION_SCHEMA as unknown as Record<string, unknown>,
      },
    };
  }
  return { type: "json_object" };
}

/**
 * One direct Novita classification. The Anthropic path enforces the output
 * shape via json_schema; here we get response_format json_object plus an
 * explicit format instruction appended to the rubric — parseClassification
 * remains the single validator for both paths.
 */
/**
 * Generic paced Novita call for the non-classification uses (cluster confirm).
 * Shares awaitRateLimitSlot with novitaClassify so the two features cannot
 * collectively exceed the account's 30 req/min, and throws the same
 * ProviderError so callers can distinguish an outage from a bad answer.
 */
export async function novitaChat(
  system: string,
  user: string,
  maxTokens = 256,
): Promise<{ raw: string; usage: NovitaUsage }> {
  const key = process.env.NOVITA_API_KEY;
  if (!key) return { raw: "", usage: { input_tokens: 0, output_tokens: 0 } };
  await awaitRateLimitSlot();
  const res = await fetch(NOVITA_URL, {
    method: "POST",
    // The worker tick is strictly sequential: a provider that accepts the
    // connection and never answers would freeze every stage behind it.
    signal: AbortSignal.timeout(NOVITA_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: NOVITA_MODEL_ID,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new ProviderError(res.status, (await res.text()).slice(0, 300));
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    raw: data.choices?.[0]?.message?.content ?? "",
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

export async function novitaClassify(
  rubricContent: string,
  userPrompt: string,
): Promise<{ parsed: ClassificationResult | null; raw: string; usage: NovitaUsage }> {
  const key = process.env.NOVITA_API_KEY;
  if (!key) return { parsed: null, raw: "", usage: { input_tokens: 0, output_tokens: 0 } };
  const formatNote =
    '\n\nFORMATO DA RESPOSTA: responda APENAS com um objeto JSON válido, sem markdown, no formato ' +
    '{"band":"E3|E2|E1|C|D1|D2|D3|NC","confidence":0.0,"reason":"...","keywords":["..."],' +
    '"category":"Política Nacional|Economia|Geopolítica|Justiça e Segurança|Religião|Saúde|Educação|Meio Ambiente|Cultura|Esportes|Outro"}.';
  await awaitRateLimitSlot();
  const res = await fetch(NOVITA_URL, {
    method: "POST",
    // The worker tick is strictly sequential: a provider that accepts the
    // connection and never answers would freeze every stage behind it.
    signal: AbortSignal.timeout(NOVITA_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: NOVITA_MODEL_ID,
      max_tokens: 1024,
      temperature: NOVITA_CLASSIFY_TEMPERATURE,
      response_format: novitaResponseFormat(),
      messages: [
        { role: "system", content: rubricContent + formatNote },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new ProviderError(res.status, text);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = data.choices?.[0]?.message?.content ?? "";
  return {
    parsed: parseClassification(raw),
    raw,
    usage: {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

/** Novita spend: list price, no batch discount, no cache tiers. */
export function estimateNovitaUsd(usage: NovitaUsage): number {
  return (
    (usage.input_tokens * NOVITA_INPUT_USD_PER_MTOK +
      usage.output_tokens * NOVITA_OUTPUT_USD_PER_MTOK) /
    1_000_000
  );
}

export function estimateUsd(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): number {
  const input = usage.input_tokens * INPUT_USD_PER_MTOK;
  const cacheWrite = (usage.cache_creation_input_tokens ?? 0) * INPUT_USD_PER_MTOK * 1.25;
  const cacheRead = (usage.cache_read_input_tokens ?? 0) * INPUT_USD_PER_MTOK * 0.1;
  const output = usage.output_tokens * OUTPUT_USD_PER_MTOK;
  return ((input + cacheWrite + cacheRead + output) / 1_000_000) * BATCH_DISCOUNT;
}
