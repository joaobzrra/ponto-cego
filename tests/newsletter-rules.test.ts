import assert from "node:assert/strict";
import test from "node:test";
import {
  brtDate,
  brtHour,
  categoryOrder,
  issueIsEmpty,
  issueUrl,
  pickBlindspots,
  pickSecondBlindspot,
  weekdayOf,
} from "@/lib/newsletter-rules";

test("brtDate/brtHour convert UTC instants to São Paulo calendar", () => {
  // 2026-09-05T02:30Z is 2026-09-04 23:30 BRT (UTC-3)
  assert.equal(brtDate(new Date("2026-09-05T02:30:00Z")), "2026-09-04");
  assert.equal(brtHour(new Date("2026-09-05T02:30:00Z")), 23);
  assert.equal(brtDate(new Date("2026-09-05T10:00:00Z")), "2026-09-05");
  assert.equal(brtHour(new Date("2026-09-05T10:00:00Z")), 7);
});

test("weekdayOf is UTC-safe", () => {
  assert.equal(weekdayOf("2026-09-06"), 0); // Sunday
  assert.equal(weekdayOf("2026-09-07"), 1); // Monday
});

test("categoryOrder starts at the weekday's category and wraps", () => {
  assert.deepEqual(categoryOrder("2026-09-07"), [
    "Geopolítica", "Saúde", "Economia", "Educação", "Meio Ambiente", "Cultura", "Justiça e Segurança",
  ]);
  assert.equal(categoryOrder("2026-09-09")[0], "Economia"); // Wednesday
  assert.equal(categoryOrder("2026-09-06")[0], "Justiça e Segurança"); // Sunday
  assert.equal(categoryOrder("2026-09-06")[1], "Geopolítica");
});

test("pickBlindspots skips recent clusters and repeats of the top subject", () => {
  const ranked = [
    { clusterId: 1, subject: "lula" },
    { clusterId: 2, subject: "lula" },
    { clusterId: 3, subject: "stf" },
    { clusterId: 4, subject: null },
  ];
  const r = pickBlindspots(ranked, new Set([1]));
  assert.equal(r.top?.clusterId, 2);
  assert.equal(r.second?.clusterId, 3);
  assert.deepEqual(pickBlindspots([], new Set()), { top: null, second: null });
  const one = pickBlindspots([{ clusterId: 9, subject: "x" }], new Set());
  assert.equal(one.top?.clusterId, 9);
  assert.equal(one.second, null);
});

test("pickSecondBlindspot skips excluded clusters and repeats of top's subject", () => {
  const ranked = [
    { clusterId: 1, subject: "lula" },
    { clusterId: 2, subject: "lula" },
    { clusterId: 3, subject: "stf" },
    { clusterId: 4, subject: null },
  ];
  const top = ranked[0];
  assert.equal(pickSecondBlindspot(ranked, top, new Set([3]))?.clusterId, 4);
  assert.equal(pickSecondBlindspot(ranked, top, new Set([3, 4])), null);
});

test("issueUrl carries the utm triplet", () => {
  assert.equal(
    issueUrl("https://pontocego.app", 42, "2026-09-05"),
    "https://pontocego.app/e/42?utm_source=newsletter&utm_medium=email&utm_campaign=2026-09-05",
  );
});

test("issueIsEmpty needs top, bottom and at least 3 middle items to be absent", () => {
  const item = { clusterId: 1, headline: "", outlet: "", sides: { esquerda: 0, centro: 0, direita: 0 }, url: "" };
  assert.equal(issueIsEmpty({ top: null, middle: [item, item], bottom: null }), true);
  assert.equal(issueIsEmpty({ top: null, middle: [item, item, item], bottom: null }), false);
  assert.equal(issueIsEmpty({ top: item, middle: [], bottom: null }), false);
});
