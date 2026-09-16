/**
 * In-process budgets for /api/e, alongside the per-session count in the DB.
 *
 * The session cap alone is client-resettable: a client that never sends the
 * pc_sess cookie back gets a fresh session — and a fresh budget — on every
 * request (security audit 2026-09-04). These two buckets do not depend on
 * anything the client controls:
 *   - per IP: PER_IP_MAX events per WINDOW_MS (a shared NAT still gets plenty);
 *   - global: GLOBAL_MAX events per WINDOW_MS, a hard ceiling on table growth.
 * Single-process state, same trade-off as patrono.ts allowStart.
 */
export const WINDOW_MS = 60 * 60 * 1000;
export const PER_IP_MAX = 600;
export const GLOBAL_MAX = 30_000;
const PRUNE_ABOVE = 5_000;

const byIp = new Map<string, number[]>();
let globalHits: number[] = [];

function recent(list: number[], cutoff: number): number[] {
  // Timestamps are appended in order; drop the expired prefix.
  let i = 0;
  while (i < list.length && list[i] <= cutoff) i++;
  return i === 0 ? list : list.slice(i);
}

export function allowEvent(ip: string, now: number = Date.now()): boolean {
  const cutoff = now - WINDOW_MS;

  globalHits = recent(globalHits, cutoff);
  if (globalHits.length >= GLOBAL_MAX) return false;

  const mine = recent(byIp.get(ip) ?? [], cutoff);
  if (mine.length >= PER_IP_MAX) {
    byIp.set(ip, mine);
    return false;
  }

  mine.push(now);
  byIp.set(ip, mine);
  globalHits.push(now);

  if (byIp.size > PRUNE_ABOVE) {
    for (const [key, list] of byIp) {
      if (list.length === 0 || list[list.length - 1] <= cutoff) byIp.delete(key);
    }
  }
  return true;
}

/** Test hook. */
export function resetEventBudget(): void {
  byIp.clear();
  globalHits = [];
}
