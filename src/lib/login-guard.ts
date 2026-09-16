/**
 * Pure helpers behind the admin login's abuse resistance (security review
 * 2026-09-02). Next-free so node:test can cover them.
 */

/** login_attempts columns are unbounded text; cap what an attacker can store. */
export const MAX_EMAIL_LEN = 254;
export const MAX_IP_LEN = 45; // longest textual IPv6

export function clampAttemptFields(ip: string, email: string): { ip: string; email: string } {
  return { ip: ip.slice(0, MAX_IP_LEN), email: email.slice(0, MAX_EMAIL_LEN) };
}

/**
 * Bounds how many argon2 verifications run at once. Each verify holds ~19 MiB
 * for its duration, and nothing else serialises concurrent login posts, so a
 * burst of a few hundred requests could exhaust the box before the
 * rate-limit row for any of them is written. Callers that cannot get a slot
 * within the queue cap treat the request as rate-limited.
 */
export class VerifyGate {
  private running = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly maxConcurrent = 4,
    private readonly maxQueued = 16,
  ) {}

  /** Returns a release function, or null when the queue is full. */
  async acquire(): Promise<(() => void) | null> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return () => this.release();
    }
    if (this.waiters.length >= this.maxQueued) return null;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.running++;
    return () => this.release();
  }

  private release() {
    this.running--;
    const next = this.waiters.shift();
    if (next) next();
  }

  get inFlight() {
    return this.running;
  }
  get queued() {
    return this.waiters.length;
  }
}
