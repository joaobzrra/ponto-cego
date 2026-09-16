/*
 * Minimal Resend REST client over fetch (spec 2026-09-04 §3). No SDK: two
 * endpoints, JSON in, JSON out. The key is read at call time so a missing key
 * fails loudly at send, never at import.
 */
import { readBodyCapped } from "@/lib/http";
import { FROM_ADDRESS, REPLY_TO } from "@/lib/newsletter";

const API = "https://api.resend.com";
const TIMEOUT_MS = 20_000;
/** Resend answers with a small JSON object; anything larger is not an answer. */
const MAX_BODY_BYTES = 256 * 1024;

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

function key(): string {
  const k = process.env.RESEND_API_KEY;
  if (!k) throw new Error("RESEND_API_KEY is not set");
  return k;
}

function body(m: OutgoingEmail) {
  return { from: FROM_ADDRESS, reply_to: REPLY_TO, to: [m.to], subject: m.subject, html: m.html, text: m.text, headers: m.headers ?? {} };
}

async function post(path: string, payload: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    // The worker tick is strictly sequential (precedent: llm.ts novitaChat): a
    // provider that accepts the connection and never answers would freeze the
    // whole send stage behind it.
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  // Capped DURING the read, never res.text() (ledger CLM-bodies-are-capped-while-streaming).
  const text = (await readBodyCapped(res, MAX_BODY_BYTES)).toString("utf8");
  if (!res.ok) throw new Error(`resend ${path} ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`resend ${path}: non-JSON body: ${text.slice(0, 120)}`);
  }
}

export async function sendEmail(msg: OutgoingEmail): Promise<{ id: string }> {
  const r = (await post("/emails", body(msg))) as { id: string };
  return { id: r.id };
}

export async function sendBatch(msgs: OutgoingEmail[]): Promise<{ ids: string[] }> {
  if (msgs.length === 0) return { ids: [] };
  if (msgs.length > 100) throw new Error("resend batch max is 100");
  const r = (await post("/emails/batch", msgs.map(body))) as { data?: Array<{ id: string }> };
  if (!Array.isArray(r?.data)) throw new Error("resend batch: unexpected response shape");
  return { ids: r.data.map((d) => d.id) };
}
