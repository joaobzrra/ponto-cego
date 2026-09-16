import assert from "node:assert/strict";
import test from "node:test";
import {
  allowEvent,
  GLOBAL_MAX,
  PER_IP_MAX,
  resetEventBudget,
  WINDOW_MS,
} from "../src/lib/event-budget";

test("per-IP budget refuses the request after PER_IP_MAX in a window", () => {
  resetEventBudget();
  const t0 = 1_000_000;
  for (let i = 0; i < PER_IP_MAX; i++) assert.equal(allowEvent("1.2.3.4", t0 + i), true);
  assert.equal(allowEvent("1.2.3.4", t0 + PER_IP_MAX), false);
  // Another IP is unaffected.
  assert.equal(allowEvent("5.6.7.8", t0 + PER_IP_MAX), true);
  // The window slides.
  assert.equal(allowEvent("1.2.3.4", t0 + WINDOW_MS + PER_IP_MAX + 1), true);
});

test("global budget caps everyone regardless of IP", () => {
  resetEventBudget();
  const t0 = 2_000_000;
  let allowed = 0;
  for (let i = 0; i < GLOBAL_MAX + 10; i++) {
    if (allowEvent(`ip-${i}`, t0)) allowed++;
  }
  assert.equal(allowed, GLOBAL_MAX);
});
