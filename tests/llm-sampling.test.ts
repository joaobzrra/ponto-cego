import assert from "node:assert/strict";
import test from "node:test";
// llm.ts transitively imports the DB module, which throws without a URL.
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";
process.env.NOVITA_API_KEY ??= "test-key-not-a-secret";
// Read at module load, so it must be set before the require below.
process.env.NOVITA_CLASSIFY_TEMPERATURE ??= "0";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { novitaClassify } = require("@/lib/llm") as typeof import("@/lib/llm");

/*
 * The band must be a property of the text, not of the sample.
 *
 * No temperature was sent until 2026-09-04, so classification ran at the
 * provider default: 4 of 5 articles returned more than one band across 5
 * repeat runs of the same rubric, one of them spanning E3 to D3 while
 * reporting 0.85-0.95 confidence. Nothing failed loudly — a missing field
 * cannot, which is why this pins it.
 */
async function captureRequestBody(): Promise<Record<string, unknown>> {
  const realFetch = globalThis.fetch;
  let captured: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    captured = JSON.parse(init.body) as Record<string, unknown>;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"band":"C","confidence":0.5,"reason":"r","keywords":[],"category":"Economia"}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    };
  }) as unknown as typeof globalThis.fetch;
  try {
    await novitaClassify("rubric", "prompt");
  } finally {
    globalThis.fetch = realFetch;
  }
  return captured;
}

test("classification sends an explicit temperature, never the provider default", async () => {
  const body = await captureRequestBody();
  assert.ok("temperature" in body, "no temperature field: the band would be sampled, not decided");
  assert.equal(body.temperature, 0);
});
