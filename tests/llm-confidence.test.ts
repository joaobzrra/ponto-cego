import assert from "node:assert/strict";
import test from "node:test";
// llm.ts transitively imports the DB module, which throws without a URL.
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseClassification } = require("@/lib/llm") as typeof import("@/lib/llm");

const base = '"band":"E1","reason":"r","keywords":["k"],"category":"Economia"';

test("denormal confidence rounds to 0 instead of underflowing Postgres real", () => {
  const r = parseClassification(`{${base},"confidence":5.515e-320}`);
  assert.equal(r?.confidence, 0);
});

test("ordinary confidence is kept to 4 places", () => {
  assert.equal(parseClassification(`{${base},"confidence":0.87654}`)?.confidence, 0.8765);
  assert.equal(parseClassification(`{${base},"confidence":1}`)?.confidence, 1);
});
