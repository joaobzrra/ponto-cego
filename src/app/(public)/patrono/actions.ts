"use server";

import { randomUUID } from "node:crypto";
import { MercadoPagoConfig, Preference } from "mercadopago";
import { getClientIp } from "@/lib/auth";
import { siteUrl } from "@/lib/seo";
import {
  allowStart,
  buildPreference,
  isPatronoEnabled,
  parseAmountCents,
  pickInitPoint,
} from "@/lib/patrono";

export type StartDonationResult = { status: "ok"; url: string } | { status: "error"; message: string };

/**
 * Server Action behind the "Doar via Mercado Pago" button (spec
 * 2026-09-02-patrono-checkout-pro-design.md). Only the amount leaves our
 * server; nothing is persisted here — the Mercado Pago panel is the ledger.
 */
export async function startDonation(amountInput: unknown): Promise<StartDonationResult> {
  if (!isPatronoEnabled()) {
    return { status: "error", message: "Doações ainda não estão abertas." };
  }

  const amountCents = parseAmountCents(amountInput);
  if (amountCents === null) {
    return { status: "error", message: "Valor inválido. Mínimo R$ 5, máximo R$ 5.000." };
  }

  // Same trust rule as admin login: proxy headers only count when
  // TRUST_PROXY_HEADERS=1, otherwise every caller shares one bucket.
  const ip = await getClientIp();
  if (!allowStart(ip)) {
    return { status: "error", message: "Muitas tentativas. Tente de novo em alguns minutos." };
  }

  const externalRef = randomUUID();
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN as string;

  try {
    const client = new MercadoPagoConfig({ accessToken, options: { timeout: 8000 } });
    const body = buildPreference(amountCents, siteUrl(), externalRef);
    const res = await new Preference(client).create({ body });
    const url = pickInitPoint(accessToken, res);
    if (!url) {
      console.error("[patrono] preference failed", new Error("no init_point in response"));
      return {
        status: "error",
        message: "Não foi possível abrir o Mercado Pago agora. Tente de novo ou use o link direto.",
      };
    }
    return { status: "ok", url };
  } catch (err) {
    console.error("[patrono] preference failed", err);
    return {
      status: "error",
      message: "Não foi possível abrir o Mercado Pago agora. Tente de novo ou use o link direto.",
    };
  }
}
