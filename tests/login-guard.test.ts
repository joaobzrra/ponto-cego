import assert from "node:assert/strict";
import test from "node:test";
import { clampAttemptFields, MAX_EMAIL_LEN, MAX_IP_LEN, VerifyGate } from "@/lib/login-guard";

test("attempt fields are clamped so a 1 MB email cannot be stored", () => {
  const { ip, email } = clampAttemptFields("x".repeat(500), "a".repeat(1_000_000));
  assert.equal(ip.length, MAX_IP_LEN);
  assert.equal(email.length, MAX_EMAIL_LEN);
  assert.deepEqual(clampAttemptFields("203.0.113.9", "a@b.c"), { ip: "203.0.113.9", email: "a@b.c" });
});

test("VerifyGate runs at most N verifies at once and rejects beyond the queue cap", async () => {
  const gate = new VerifyGate(2, 1);
  const r1 = await gate.acquire();
  const r2 = await gate.acquire();
  assert.ok(r1 && r2);
  assert.equal(gate.inFlight, 2);

  // third caller queues (cap 1), fourth is refused outright
  const third = gate.acquire();
  assert.equal(gate.queued, 1);
  const fourth = await gate.acquire();
  assert.equal(fourth, null);

  r1!();
  const r3 = await third;
  assert.ok(r3);
  assert.equal(gate.inFlight, 2);
  r2!();
  r3!();
  assert.equal(gate.inFlight, 0);
  assert.equal(gate.queued, 0);
});
