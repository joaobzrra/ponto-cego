import assert from "node:assert/strict";
import test from "node:test";
import { splitByGateSeen } from "@/worker/classify-plan";

/**
 * Regression: during the Novita balance outage of 2026-07-24 the classifier
 * re-selected the same oldest 300 pending articles every cycle. They had all
 * already passed the gate (they carry the batch id of the cycle that queued
 * them, which releaseQueued does not clear), so the gate scored 0 new articles
 * for ~40h while 2,209 never-gated rows sat untouched behind them.
 */
test("rows already scored by the gate are not sent through it again", () => {
  const rows = [
    { id: 1, classifyBatchId: 7 },
    { id: 2, classifyBatchId: null },
    { id: 3, classifyBatchId: 9 },
  ];

  const { gateSeen, needsGate } = splitByGateSeen(rows);

  assert.deepEqual(
    needsGate.map((r) => r.id),
    [2],
  );
  assert.deepEqual(
    gateSeen.map((r) => r.id),
    [1, 3],
  );
});

test("splitting a pending batch never drops an article", () => {
  const rows = [
    { id: 1, classifyBatchId: 7 },
    { id: 2, classifyBatchId: null },
    { id: 3, classifyBatchId: 9 },
  ];

  const { gateSeen, needsGate } = splitByGateSeen(rows);

  // A gate-seen row that fell out of BOTH buckets would be silently unclassifiable.
  assert.deepEqual(
    [...gateSeen, ...needsGate].map((r) => r.id).sort(),
    [1, 2, 3],
  );
});
