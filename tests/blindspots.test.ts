import assert from "node:assert/strict";
import test from "node:test";
import { ageCaption, rankBlindspots, type BlindspotCandidate } from "@/lib/blindspots";

const d = (iso: string) => new Date(iso);
const row = (p: Partial<BlindspotCandidate> & { clusterId: number }): BlindspotCandidate => ({
  title: `c${p.clusterId}`,
  sides: { esquerda: 0, centro: 3, direita: 2 },
  politicalArticles: 6,
  subject: null,
  keywords: [],
  thumbnailPath: null,
  firstAt: d("2026-09-01T00:00:00Z"),
  lastAt: d("2026-09-02T00:00:00Z"),
  ...p,
});

test("keeps only clusters where exactly one side is at or under maxShare", () => {
  const out = rankBlindspots([
    row({ clusterId: 1, sides: { esquerda: 0, centro: 3, direita: 2 } }), // esquerda 0%
    row({ clusterId: 2, sides: { esquerda: 0, centro: 4, direita: 0 } }), // both thin → excluded
    row({ clusterId: 3, sides: { esquerda: 2, centro: 2, direita: 2 } }), // balanced → excluded
    row({ clusterId: 4, sides: { esquerda: 1, centro: 2, direita: 3 } }), // 1/6 = 17%
  ]);
  assert.deepEqual(out.map((b) => b.clusterId), [1, 4]);
  assert.equal(out[0].weakSide, "esquerda");
  assert.equal(out[1].weakShare, 1 / 6);
});

test("ranks by weak share asc, then total outlets desc, then recency desc", () => {
  const out = rankBlindspots([
    row({ clusterId: 1, sides: { esquerda: 1, centro: 4, direita: 4 } }), // 11%, 9 outlets
    row({ clusterId: 2, sides: { esquerda: 0, centro: 2, direita: 2 }, lastAt: d("2026-09-01T00:00:00Z") }), // 0%, 4
    row({ clusterId: 3, sides: { esquerda: 0, centro: 3, direita: 3 } }), // 0%, 6
    row({ clusterId: 4, sides: { esquerda: 0, centro: 2, direita: 2 }, lastAt: d("2026-09-02T12:00:00Z") }), // 0%, 4, newer
  ]);
  assert.deepEqual(out.map((b) => b.clusterId), [3, 4, 2, 1]);
});

test("one card per subject keeps the best-ranked cluster of each subject", () => {
  const rows = [
    row({ clusterId: 1, subject: "lula", sides: { esquerda: 0, centro: 3, direita: 3 } }),
    row({ clusterId: 2, subject: "lula", sides: { esquerda: 0, centro: 2, direita: 2 } }),
    row({ clusterId: 3, subject: null, sides: { esquerda: 0, centro: 2, direita: 2 } }),
    row({ clusterId: 4, subject: null, sides: { esquerda: 0, centro: 2, direita: 2 } }),
  ];
  assert.deepEqual(rankBlindspots(rows).map((b) => b.clusterId), [1, 3, 4]);
  // onePerSubject:false keeps the duplicate subject — assert it on the RAW
  // candidates, not on the already-filtered result (which cannot tell us
  // anything). This is the list the topic sections read (fix wave item C).
  assert.deepEqual(
    rankBlindspots(rows, { onePerSubject: false }).map((b) => b.clusterId),
    [1, 2, 3, 4],
  );
});

test("ageCaption speaks in days since the first article", () => {
  const now = d("2026-09-03T12:00:00Z");
  assert.equal(ageCaption(d("2026-09-03T02:00:00Z"), now), "hoje");
  assert.equal(ageCaption(d("2026-09-02T02:00:00Z"), now), "há 1 dia");
  assert.equal(ageCaption(d("2026-08-31T02:00:00Z"), now), "há 3 dias");
});
