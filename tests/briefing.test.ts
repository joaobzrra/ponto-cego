import assert from "node:assert/strict";
import test from "node:test";
// briefing.ts transitively imports the DB module, which throws without a URL.
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseBriefingLine, readingMinutes } = require("@/lib/briefing") as typeof import("@/lib/briefing");

test("reading minutes is ceil(words / 200) with a floor of 1", () => {
  assert.equal(readingMinutes([]), 1);
  assert.equal(readingMinutes(["uma frase curta"]), 1);
  assert.equal(readingMinutes([Array(201).fill("palavra").join(" ")]), 2);
});

test("parses the provider JSON and rejects long or empty lines", () => {
  assert.equal(parseBriefingLine('{"linha": " Senado aprova projeto. "}'), "Senado aprova projeto.");
  assert.equal(parseBriefingLine('{"linha": ""}'), null);
  assert.equal(parseBriefingLine("not json"), null);
  assert.equal(parseBriefingLine(`{"linha": "${"x".repeat(161)}"}`), null);
});
