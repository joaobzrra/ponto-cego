/**
 * Pure planning helpers for the classify cycle. Deliberately dependency-free
 * (no db, no env) so the cycle's selection rules can be unit-tested — the bugs
 * that hurt here are ordering/eligibility mistakes, not SQL typos.
 */

/** Any pending row, as far as gate bookkeeping is concerned. */
type Batched = { classifyBatchId: number | null };

/**
 * Split a pending batch by whether the NC gate has already scored it.
 *
 * A row acquires `classify_batch_id` when a cycle queues it for the paid model,
 * which happens only AFTER it survived the gate. `releaseQueued` and
 * `recordArticleFailure` return it to `pending` without clearing that id, so a
 * non-null batch id is a durable "the gate already saw this and kept it" mark —
 * no extra column needed.
 *
 * Both buckets still get classified; only `needsGate` costs gate inference.
 */
export function splitByGateSeen<T extends Batched>(rows: T[]): { gateSeen: T[]; needsGate: T[] } {
  const gateSeen: T[] = [];
  const needsGate: T[] = [];
  for (const row of rows) {
    if (row.classifyBatchId === null) needsGate.push(row);
    else gateSeen.push(row);
  }
  return { gateSeen, needsGate };
}
