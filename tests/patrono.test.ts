import assert from "node:assert/strict";
import test from "node:test";
import {
  allowStart,
  buildPreference,
  MAX_CENTS,
  MIN_CENTS,
  parseAmountCents,
  pickInitPoint,
} from "@/lib/patrono";

test("parseAmountCents accepts valid inputs", () => {
  assert.equal(parseAmountCents("25"), 2500);
  assert.equal(parseAmountCents("25,50"), 2550);
  assert.equal(parseAmountCents("R$ 100"), 10000);
  assert.equal(parseAmountCents("25.5"), 2550); // phone keyboards without a comma
  assert.equal(parseAmountCents("1.000,00"), 100000);
  assert.equal(parseAmountCents(1000), 1000);
  assert.equal(parseAmountCents(MIN_CENTS), MIN_CENTS); // numeric input is already centavos, at the floor
});

test("parseAmountCents rejects invalid or out-of-range inputs", () => {
  assert.equal(parseAmountCents("4"), null); // R$4 => 400 centavos, below MIN_CENTS
  assert.equal(parseAmountCents("abc"), null);
  assert.equal(parseAmountCents(500001), null);
  assert.equal(parseAmountCents(-100), null);
  assert.equal(parseAmountCents(""), null);
  assert.equal(parseAmountCents(MAX_CENTS + 1), null);
});

test("buildPreference sets back_urls, unit_price and a 1h expiry window", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  const pref = buildPreference(2550, "https://pontocego.app", "ext-ref-1", now);

  assert.equal(pref.items.length, 1);
  assert.equal(pref.items[0].unit_price, 25.5);
  assert.equal(pref.items[0].currency_id, "BRL");
  assert.equal(pref.back_urls.success, "https://pontocego.app/patrono/obrigado");
  assert.equal(pref.back_urls.pending, "https://pontocego.app/patrono/obrigado");
  assert.equal(pref.back_urls.failure, "https://pontocego.app/patrono/obrigado");
  assert.equal(pref.auto_return, "approved");
  assert.equal(pref.statement_descriptor, "PONTO CEGO");
  assert.equal(pref.expires, true);
  assert.equal(pref.expiration_date_from, "2026-09-02T12:00:00.000+00:00");
  assert.equal(pref.expiration_date_to, "2026-09-02T13:00:00.000+00:00");
  assert.equal(pref.external_reference, "ext-ref-1");
});

test("pickInitPoint routes TEST- tokens to sandbox, everything else to prod", () => {
  const res = { init_point: "https://mp/prod", sandbox_init_point: "https://mp/sandbox" };
  assert.equal(pickInitPoint("TEST-abc123", res), "https://mp/sandbox");
  assert.equal(pickInitPoint("APP_USR-abc123", res), "https://mp/prod");
  assert.equal(pickInitPoint("TEST-abc123", { init_point: "https://mp/prod" }), null);
});

test("allowStart permits 10 starts per IP per window then blocks the 11th, resetting after the window", () => {
  const ip = "203.0.113.9";
  const t0 = 1_000_000;

  for (let i = 0; i < 10; i++) {
    assert.equal(allowStart(ip, t0 + i), true, `start ${i + 1} should be allowed`);
  }
  assert.equal(allowStart(ip, t0 + 10), false);

  // Just under 10 minutes later: still blocked.
  assert.equal(allowStart(ip, t0 + 10 * 60 * 1000 - 1), false);

  // 10 minutes and 1ms after the FIRST start: that start has aged out.
  assert.equal(allowStart(ip, t0 + 10 * 60 * 1000 + 1), true);
});
