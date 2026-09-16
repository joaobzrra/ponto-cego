import assert from "node:assert/strict";
import test from "node:test";
import { capExcerpt, pickExcerpt } from "@/lib/excerpt";

/*
 * Regression: Estadão ships <description></description> — present but EMPTY —
 * alongside a full <content:encoded>. rss-parser turns the empty description
 * into contentSnippet:"" and content:"", and the old poller expression
 *   capExcerpt(item.contentSnippet ?? item.summary ?? item.content)
 * short-circuited on "" because ?? only falls through on null/undefined. The
 * article was stored with an empty excerpt, so embeddingInput() embedded the
 * TITLE ALONE. Measured consequence on production: two byte-identical titles
 * (Folha vs UOL) sat at 0.5075 cosine — under dedup 0.97, attach 0.86 and even
 * review 0.78 — so the same story never merged. 100% of Estadão's 1,058
 * articles were affected and it was the most-isolated outlet in the database
 * (92.9% of its articles clustered alone).
 */

test("falls through an EMPTY description to content:encoded", () => {
  const item = {
    contentSnippet: "",
    content: "",
    "content:encoded": "<p>BRASÍLIA e SÃO PAULO - O candidato do PL à Presidência afirmou nesta sexta.</p>",
  };
  assert.equal(
    pickExcerpt(item),
    "BRASÍLIA e SÃO PAULO - O candidato do PL à Presidência afirmou nesta sexta.",
  );
});

test("prefers the feed's own snippet when it actually has text", () => {
  const item = {
    contentSnippet: "O ministro afirmou que a decisão sai amanhã.",
    content: "<p>should not be used</p>",
    "content:encoded": "<p>should not be used either</p>",
  };
  assert.equal(pickExcerpt(item), "O ministro afirmou que a decisão sai amanhã.");
});

test("whitespace-only and tag-only candidates count as absent", () => {
  // UOL prefixes every description with an <img>; a description that is ONLY
  // that tag has no text once stripped and must not win over a later field.
  const item = {
    contentSnippet: "   ",
    content: '<img src="x.jpg" align="left" />',
    "content:encoded": "<p>Texto real do corpo da matéria.</p>",
  };
  assert.equal(pickExcerpt(item), "Texto real do corpo da matéria.");
});

test("returns empty when the feed genuinely carries no text anywhere", () => {
  assert.equal(pickExcerpt({ contentSnippet: "", content: "", "content:encoded": "" }), "");
  assert.equal(pickExcerpt({}), "");
});

test("still enforces the 20-word legal cap on whatever it picks", () => {
  const long = Array.from({ length: 40 }, (_, i) => `palavra${i + 1}`).join(" ");
  const picked = pickExcerpt({ "content:encoded": `<p>${long}</p>` });
  assert.equal(picked, capExcerpt(long));
  assert.equal(picked.split(" ").length, 20);
  assert.ok(picked.endsWith("…"));
});
