"use server";

import { redirect } from "next/navigation";
import { getClientIp } from "@/lib/auth";
import { normalizeEmail, unsubscribeByToken, upsertPendingSubscriber } from "@/lib/newsletter";
import { sendEmail } from "@/lib/resend";
import { siteUrl } from "@/lib/seo";

export type SubscribeResult = { status: "ok" | "error"; message: string };

const NEUTRAL = "Se o endereço for válido, você recebe um link de confirmação em instantes.";

// Per-IP: 5 signups/hour, in-process (the site runs as one container). Does
// NOT share the /api/e analytics budget (event-budget.ts) — signup abuse and
// event-flood abuse are different problems with different attackers.
const signups = new Map<string, number[]>();
const SIGNUPS_PRUNE_ABOVE = 1_000;

function allowSignup(ip: string, now = Date.now()): boolean {
  const cutoff = now - 60 * 60 * 1000;
  const arr = (signups.get(ip) ?? []).filter((t) => t > cutoff);
  if (arr.length >= 5) { signups.set(ip, arr); return false; }
  arr.push(now); signups.set(ip, arr);

  if (signups.size > SIGNUPS_PRUNE_ABOVE) {
    for (const [key, list] of signups) {
      if (list.length === 0 || list[list.length - 1] <= cutoff) signups.delete(key);
    }
  }
  return true;
}

export async function subscribe(formData: FormData): Promise<SubscribeResult> {
  const email = normalizeEmail(formData.get("email"));
  const source = formData.get("source") === "home-box" ? "home-box" : "newsletter-page";
  if (!email) return { status: "error", message: "Digite um e-mail válido." };
  const ip = await getClientIp();
  if (!allowSignup(ip)) return { status: "error", message: "Muitas tentativas. Tente de novo em uma hora." };
  try {
    // `throttled`: a confirmation for this address went out under 10 minutes
    // ago and the token was NOT regenerated — skip the mail, keep the answer
    // neutral (the form never reveals list state).
    const { token, alreadyConfirmed, throttled } = await upsertPendingSubscriber(email, source);
    if (!alreadyConfirmed && !throttled) {
      const base = siteUrl();
      const url = `${base}/newsletter/confirmar?t=${token}`;
      await sendEmail({
        to: email,
        subject: "Confirme sua inscrição no Ponto Cego",
        html: `<p>Você pediu para receber o boletim diário do Ponto Cego.</p><p><a href="${url}">Confirmar inscrição</a></p><p>Se não foi você, ignore este e-mail. Nada é enviado sem confirmação.</p>`,
        text: `Confirme sua inscrição: ${url}\nSe não foi você, ignore este e-mail.`,
      });
    }
  } catch (err) {
    console.error("newsletter subscribe failed", err);
    // Neutral on purpose: the form never reveals list membership or provider state.
  }
  return { status: "ok", message: NEUTRAL };
}

/** Server Action behind the one-button form at /newsletter/sair. */
export async function leave(formData: FormData): Promise<void> {
  const t = String(formData.get("t"));
  const ok = /^[0-9a-f]{64}$/.test(t) && (await unsubscribeByToken(t));
  redirect(`/newsletter/sair?${ok ? "done=1" : "erro=1"}`);
}
