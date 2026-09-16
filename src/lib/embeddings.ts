/**
 * Local embedding client (stage 5, spec §3.4.1) — Ollama over HTTP.
 *
 * Model runs on the user's GPU (bge-m3, 1024 dims — MUST match the
 * articles.embedding vector(1024) column; changing models means changing the
 * column and re-embedding everything). Ollama unloads the model when idle,
 * so the GPU stays free for the user's creative work between bursts.
 *
 * Never throws on connectivity problems: returns null so callers can skip
 * the cycle quietly (same posture as the classifier under the API cap).
 */
export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const EMBED_MODEL_ID = process.env.EMBED_MODEL_ID ?? "bge-m3";
export const EMBED_DIMENSIONS = 1024;

/** The exact text an article is embedded from — title + capped excerpt. */
export function embeddingInput(a: { title: string; excerpt: string }): string {
  return `${a.title}\n${a.excerpt}`.trim();
}

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL_ID, input: texts }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings?: number[][] };
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
      return null;
    }
    if (data.embeddings[0]?.length !== EMBED_DIMENSIONS) return null; // wrong model loaded
    return data.embeddings;
  } catch {
    return null;
  }
}

/** True when Ollama is reachable and the model is available. */
export async function embedServiceReady(): Promise<boolean> {
  const result = await embedTexts(["ping"]);
  return result !== null;
}
