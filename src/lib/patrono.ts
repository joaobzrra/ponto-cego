/**
 * Patrono — one-off donations via Mercado Pago Checkout Pro (spec
 * 2026-09-02-patrono-checkout-pro-design.md). This module is pure and
 * SDK-free so it can be unit-tested without hitting Mercado Pago.
 *
 * No donor data is stored on our side. `external_reference` is generated
 * per attempt and never persisted — the Mercado Pago panel is the ledger.
 */

export const PRESET_CENTS = [1000, 2500, 5000, 10000] as const;
export const MIN_CENTS = 500;
export const MAX_CENTS = 500000;

/**
 * Parses a donation amount into integer centavos. Accepts a plain number
 * (already centavos) or a Brazilian-formatted reais string ("25",
 * "25,50", "R$ 25,50"). Returns null when the value is not a valid amount
 * or falls outside [MIN_CENTS, MAX_CENTS].
 */
export function parseAmountCents(input: unknown): number | null {
  let cents: number;

  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    cents = Math.round(input);
  } else if (typeof input === "string") {
    const trimmed = input.trim().replace(/^R\$\s*/i, "");
    if (trimmed === "") return null;
    // Brazilian format uses comma as decimal separator ("25,50"; "1.000,00").
    // A lone dot followed by 1–2 digits ("25.5") is read as a decimal too,
    // because keyboards on some phones only offer the dot.
    const normalized = /^\d+\.\d{1,2}$/.test(trimmed)
      ? trimmed
      : trimmed.replace(/\./g, "").replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
    const reais = Number(normalized);
    if (!Number.isFinite(reais)) return null;
    cents = Math.round(reais * 100);
  } else {
    return null;
  }

  if (!Number.isInteger(cents)) return null;
  if (cents < MIN_CENTS || cents > MAX_CENTS) return null;
  return cents;
}

export type PreferenceBody = {
  items: Array<{
    id: string;
    title: string;
    quantity: number;
    unit_price: number;
    currency_id: string;
  }>;
  back_urls: { success: string; pending: string; failure: string };
  auto_return: string;
  statement_descriptor: string;
  expires: boolean;
  expiration_date_from: string;
  expiration_date_to: string;
  external_reference: string;
};

/**
 * Mercado Pago documents expiry timestamps with an explicit numeric offset
 * ("2016-02-01T12:00:00.000-04:00"), not the `Z` suffix Date#toISOString
 * emits. Same instant, spelled the way their examples spell it.
 */
export function mpTimestamp(d: Date): string {
  return d.toISOString().replace(/Z$/, "+00:00");
}

/** Builds the Checkout Pro preference body. `now` is injectable for tests. */
export function buildPreference(
  amountCents: number,
  siteUrl: string,
  externalRef: string,
  now: Date = new Date(),
): PreferenceBody {
  const successUrl = `${siteUrl}/patrono/obrigado`;
  const from = new Date(now);
  const to = new Date(now.getTime() + 60 * 60 * 1000);

  return {
    items: [
      {
        id: "patrono",
        title: "Apoio ao Ponto Cego",
        quantity: 1,
        unit_price: amountCents / 100,
        currency_id: "BRL",
      },
    ],
    back_urls: { success: successUrl, pending: successUrl, failure: successUrl },
    auto_return: "approved",
    statement_descriptor: "PONTO CEGO",
    expires: true,
    expiration_date_from: mpTimestamp(from),
    expiration_date_to: mpTimestamp(to),
    external_reference: externalRef,
  };
}

/** TEST- access tokens are sandbox tokens; everything else is production. */
export function pickInitPoint(
  token: string,
  res: { init_point?: string; sandbox_init_point?: string },
): string | null {
  const url = token.startsWith("TEST-") ? res.sandbox_init_point : res.init_point;
  return url ?? null;
}

export function isPatronoEnabled(): boolean {
  return !!process.env.MERCADOPAGO_ACCESS_TOKEN;
}

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/** ip -> timestamps of starts within the current window. */
const startsByIp = new Map<string, number[]>();

/**
 * In-process token bucket: at most RATE_LIMIT_MAX starts per IP per
 * RATE_LIMIT_WINDOW_MS. No table, no cookie (spec). Not shared across
 * processes/instances — acceptable for a single-box deployment.
 */
export function allowStart(ip: string, now: number = Date.now()): boolean {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const existing = startsByIp.get(ip) ?? [];
  const recent = existing.filter((t) => t > cutoff);

  if (recent.length >= RATE_LIMIT_MAX) {
    startsByIp.set(ip, recent);
    return false;
  }

  recent.push(now);
  startsByIp.set(ip, recent);
  return true;
}
