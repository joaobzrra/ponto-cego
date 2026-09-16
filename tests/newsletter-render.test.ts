import assert from "node:assert/strict";
import test from "node:test";
import type { Issue } from "@/lib/newsletter-rules";
import { escapeHtml, renderIssueHtml, renderIssueText, subjectFor } from "@/lib/newsletter-render";

const item = (id: number, over: Partial<Issue["middle"][number]> = {}) => ({
  clusterId: id,
  headline: `Manchete <${id}> & "aspas"`,
  outlet: "Folha de S.Paulo",
  sides: { esquerda: 3, centro: 10, direita: 1 },
  url: `https://pontocego.app/e/${id}?utm_source=newsletter&utm_medium=email&utm_campaign=2026-09-05`,
  ...over,
});
const issue: Issue = {
  version: 1,
  date: "2026-09-05",
  top: item(1, { weakSide: "direita", weakShare: 0.07 }),
  middle: [item(2, { line: "Linha automática." }), item(3)],
  bottom: { category: "Saúde", item: item(4) },
  second: item(5, { weakSide: "esquerda", weakShare: 0 }),
  composedAt: "2026-09-05T10:00:00.000Z",
};
const opts = {
  siteUrl: "https://pontocego.app",
  unsubscribeUrl: "https://pontocego.app/newsletter/sair?t=abc",
  viewUrl: "https://pontocego.app/newsletter/2026-09-05",
};

test("escapeHtml escapes the five characters", () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
});

test("html contains the four sections, escaped headlines, links, unsubscribe and the automatic tag", () => {
  const html = renderIssueHtml(issue, opts);
  for (const s of ["PONTO CEGO DO DIA", "MAIS DISCUTIDOS", "PASSOU DESPERCEBIDO", "SEGUNDO PONTO CEGO"]) assert.ok(html.includes(s), s);
  assert.ok(html.includes("Manchete &lt;1&gt; &amp; &quot;aspas&quot;"));
  assert.ok(!html.includes("<1>"));
  assert.ok(html.includes(opts.unsubscribeUrl));
  assert.ok(html.includes(opts.viewUrl));
  assert.ok(html.includes("RESUMO AUTOMÁTICO"));
  assert.ok(html.includes("3 esquerda · 10 centro · 1 direita"));
  assert.ok(html.includes("Saúde"));
  assert.ok(!html.includes("<script"));
  // Owner ruling 2026-09-04: exactly one image, the wordmark from our own
  // host — never a tracking pixel or a third-party image.
  assert.equal(html.split("<img").length - 1, 1);
  assert.ok(html.includes('src="https://pontocego.app/brand/pontocego-logo.png"'));
  assert.ok(html.includes("Resumo do dia 05/09 - Viés sugestivo, não um veredito"));
  assert.ok(html.includes("Questione, classifique diretamente pelo"));
});

test("sections that are null are omitted", () => {
  const html = renderIssueHtml({ ...issue, top: null, bottom: null, second: null }, opts);
  assert.ok(!html.includes("PONTO CEGO DO DIA"));
  assert.ok(!html.includes("PASSOU DESPERCEBIDO"));
  assert.ok(html.includes("MAIS DISCUTIDOS"));
});

test("text version lists headlines with urls", () => {
  const txt = renderIssueText(issue, opts);
  assert.ok(txt.includes('Manchete <2> & "aspas"'));
  assert.ok(txt.includes("https://pontocego.app/e/2?"));
  assert.ok(txt.includes(opts.unsubscribeUrl));
});

test("subject is fixed: PONTO CEGO | RESUMO DO DIA dd/mm", () => {
  assert.equal(subjectFor(issue), "PONTO CEGO | RESUMO DO DIA 05/09");
  assert.equal(subjectFor({ ...issue, top: null }), "PONTO CEGO | RESUMO DO DIA 05/09");
});

test("a zero-share side renders no cell for that side but the sides line still counts it", () => {
  const zeroShare: Issue = { ...issue, top: item(1, { sides: { esquerda: 0, centro: 10, direita: 2 } }), middle: [], bottom: null, second: null };
  const html = renderIssueHtml(zeroShare, opts);
  const barCells = [...html.matchAll(/width="\d+%" height="8"/g)];
  assert.equal(barCells.length, 2);
  assert.ok(html.includes("0 esquerda · 10 centro · 2 direita"));
});

test("all-zero sides renders no bar table but still renders the headline", () => {
  const allZero: Issue = { ...issue, top: item(1, { sides: { esquerda: 0, centro: 0, direita: 0 } }), middle: [], bottom: null, second: null };
  const html = renderIssueHtml(allZero, opts);
  assert.ok(!html.includes('cellspacing="2"'));
  assert.ok(html.includes("Manchete &lt;1&gt;"));
});

test("bar segment widths are normalized to sum exactly 100, no non-zero side below 4%", () => {
  const skewed: Issue = { ...issue, top: item(1, { sides: { esquerda: 1, centro: 1, direita: 100 } }), middle: [], bottom: null, second: null };
  const html = renderIssueHtml(skewed, opts);
  const widths = [...html.matchAll(/width="(\d+)%" height="8"/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 3);
  assert.equal(widths[0] + widths[1] + widths[2], 100);
  assert.equal(widths[0], 4);
  assert.equal(widths[1], 4);
});
