import assert from "node:assert/strict";
import test from "node:test";
import type { Blindspot } from "@/lib/blindspots";
import { consumeBlindspots } from "@/lib/consume-blindspots";

/*
 * Pure test of the one consumption order (fix wave item C). No DB: the two
 * ranked lists are handed in already ranked, exactly as homeData does.
 */
const b = (
  clusterId: number,
  p: Partial<Blindspot> = {},
): Blindspot => ({
  clusterId,
  title: `c${clusterId}`,
  sides: { esquerda: 0, centro: 3, direita: 3 },
  politicalArticles: 6,
  subject: null,
  keywords: [],
  thumbnailPath: null,
  firstAt: new Date("2026-09-01T00:00:00Z"),
  lastAt: new Date("2026-09-02T00:00:00Z"),
  totalOutlets: 6,
  weakSide: "esquerda",
  weakShare: 0,
  ...p,
});

/** 10 blindspots: 1-8 esquerda-weak, 9-10 direita-weak; subjects repeat. */
const all: Blindspot[] = [
  b(1, { subject: "moraes", keywords: ["moraes", "stf"] }),
  b(2, { subject: "moraes", keywords: ["moraes"] }),
  b(3, { subject: "moraes", keywords: ["moraes", "stf"] }),
  b(4, { subject: "lula", keywords: ["lula"] }),
  b(5, { subject: "lula", keywords: ["lula", "stf"] }),
  b(6, { subject: "tarifas", keywords: ["tarifas"] }),
  b(7, { subject: "irã", keywords: ["irã"] }),
  b(8, { subject: null, keywords: ["moraes"] }),
  b(9, { subject: "vorcaro", keywords: ["vorcaro"], weakSide: "direita" }),
  b(10, { subject: "vorcaro", keywords: ["vorcaro"], weakSide: "direita" }),
];
/** The one-per-subject view of the same ranking, first cluster per subject. */
const onePer = all.filter((x) => [1, 4, 6, 7, 8, 9].includes(x.clusterId));

test("featured is rank 1 and weekly is the next four of the one-per-subject list", () => {
  const used = new Set<number>();
  const out = consumeBlindspots(onePer, all, [], used);
  assert.equal(out.featured?.clusterId, 1);
  assert.deepEqual(out.weekly.map((x) => x.clusterId), [4, 6, 7, 8]);
});

test("the pair takes the next cluster of each weak side", () => {
  const used = new Set<number>();
  const out = consumeBlindspots(onePer, all, [], used);
  assert.equal(out.pair.direita?.clusterId, 9);
  assert.equal(out.pair.direita?.weakSide, "direita");
  // Every esquerda-weak cluster of the one-per-subject list is already spent.
  assert.equal(out.pair.esquerda, null);
});

test("topic cards come from rankedAll, so same-subject cards are allowed inside one keyword", () => {
  const used = new Set<number>();
  const out = consumeBlindspots(onePer, all, ["Moraes"], used, { weekly: 0 });
  // 1 is the featured; 2 and 3 share its subject and would be gone from the
  // one-per-subject list, but the topic section still fills.
  assert.deepEqual(out.byKeyword.get("moraes")?.map((x) => x.clusterId), [2, 3, 8]);
});

test("no cluster id appears twice across every output", () => {
  const used = new Set<number>();
  const out = consumeBlindspots(onePer, all, ["moraes", "lula", "vorcaro"], used);
  const ids = [
    ...(out.featured ? [out.featured.clusterId] : []),
    ...out.weekly.map((x) => x.clusterId),
    ...(out.pair.direita ? [out.pair.direita.clusterId] : []),
    ...(out.pair.esquerda ? [out.pair.esquerda.clusterId] : []),
    ...[...out.byKeyword.values()].flatMap((cards) => cards.map((x) => x.clusterId)),
  ];
  assert.equal(new Set(ids).size, ids.length);
});

test("a keyword with no free card is absent from byKeyword", () => {
  const used = new Set<number>();
  const out = consumeBlindspots(onePer, all, ["irã", "inexistente"], used);
  // 7 (the only irã cluster) is spent by the weekly list, so irã has nothing.
  assert.equal(out.byKeyword.has("irã"), false);
  assert.equal(out.byKeyword.has("inexistente"), false);
});

test("topic cards are proposed, not claimed: the caller's used set is untouched by them", () => {
  const used = new Set<number>();
  const out = consumeBlindspots(onePer, all, ["moraes"], used, { weekly: 0 });
  const proposed = out.byKeyword.get("moraes")!.map((x) => x.clusterId);
  for (const id of proposed) assert.equal(used.has(id), false);
  // The rail picks it did claim are in there.
  assert.equal(used.has(out.featured!.clusterId), true);
});

test("perKeyword controls how many cards are proposed, so the caller can over-fetch", () => {
  // homeData asks for TOPIC_CARDS + 1 and keeps the first TOPIC_CARDS that
  // survive its own re-check against the shared used set: the keyword's lead
  // may itself be one of the proposals, and an earlier section may have
  // claimed another since the proposals were frozen.
  const three = consumeBlindspots(onePer, all, ["moraes"], new Set(), {
    weekly: 0,
    perKeyword: 3,
  });
  assert.deepEqual(three.byKeyword.get("moraes")?.map((x) => x.clusterId), [2, 3, 8]);
  const four = consumeBlindspots(onePer, all, ["moraes"], new Set(), {
    weekly: 0,
    perKeyword: 4,
  });
  // Only three moraes clusters are free, so the spare is simply unavailable —
  // over-fetching never invents a card.
  assert.deepEqual(four.byKeyword.get("moraes")?.map((x) => x.clusterId), [2, 3, 8]);
  const two = consumeBlindspots(onePer, all, ["moraes"], new Set(), {
    weekly: 0,
    perKeyword: 2,
  });
  assert.deepEqual(two.byKeyword.get("moraes")?.map((x) => x.clusterId), [2, 3]);
});

test("clusters already in the caller's used set are never handed out", () => {
  const used = new Set<number>([1, 4, 2]);
  const out = consumeBlindspots(onePer, all, ["moraes"], used, { weekly: 1 });
  assert.equal(out.featured?.clusterId, 6);
  assert.deepEqual(out.weekly.map((x) => x.clusterId), [7]);
  assert.deepEqual(out.byKeyword.get("moraes")?.map((x) => x.clusterId), [3]);
});
