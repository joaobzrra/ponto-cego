"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import {
  composeIssue,
  confirmedSubscribers,
  getIssue,
  insertIssue,
  markIssueFailed,
  markIssueSent,
  normalizeEmail,
} from "@/lib/newsletter";
import { renderIssueHtml } from "@/lib/newsletter-render";
import { brtDate, type Issue } from "@/lib/newsletter-rules";
import { siteUrl } from "@/lib/seo";
import { PartialSendError, sendIssueTo } from "@/worker/newsletter";

const REDIRECT_PATH = "/admin/newsletter";

function withMsg(msg: string): never {
  redirect(`${REDIRECT_PATH}?msg=${encodeURIComponent(msg)}`);
}

/** Composes today's BRT issue if one doesn't exist yet (spec §5, ruling 3). */
export async function composeToday(): Promise<void> {
  const admin = await requireAdmin();
  const date = brtDate(new Date());
  let msg: string;
  if (await getIssue(date)) {
    msg = "Já existe edição para hoje.";
  } else {
    try {
      const issue = await composeIssue(date);
      const base = siteUrl();
      const html = renderIssueHtml(issue, {
        siteUrl: base,
        unsubscribeUrl: `${base}/newsletter`,
        viewUrl: `${base}/newsletter/${date}`,
      });
      // status `preview`, never `composed`: the 7h worker takes a preview row
      // over (claimIssueForSend) instead of treating it as the day already
      // sent, so an admin dry run can never cancel the day's send.
      await insertIssue(date, issue, html, "preview");
      await writeAudit(admin.id, "newsletter.compose_today", { type: "newsletter_issue", id: date });
      msg = "Prévia composta (não bloqueia o envio das 7h).";
      revalidatePath(REDIRECT_PATH);
    } catch (err) {
      console.error("newsletter composeToday failed", err);
      await writeAudit(admin.id, "newsletter.compose_failed", { type: "newsletter_issue", id: date });
      const short = (err instanceof Error ? err.message : String(err)).slice(0, 120);
      msg = `Compor falhou: ${short}`;
    }
  }
  withMsg(msg);
}

/**
 * Resend an issue's email. Controller ruling: refused when `provider_ref` is
 * non-empty — a partial send already reached some recipients and re-sending
 * would mail them twice. Only `failed`/`composed` rows with an empty
 * provider_ref may be re-sent.
 */
export async function resendIssue(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const date = String(formData.get("date") ?? "");
  const row = await getIssue(date);
  let msg: string;
  if (!row) {
    msg = "Edição não encontrada.";
  } else if (row.providerRef) {
    msg =
      "Reenvio bloqueado: já houve envio parcial (provider_ref preenchido). Apague o registro e componha de novo se for intencional.";
  } else if (row.status !== "failed" && row.status !== "composed" && row.status !== "preview") {
    msg = "Reenvio só é permitido para edições com status failed, composed ou preview.";
  } else {
    try {
      const recipients = await confirmedSubscribers();
      const { ids } = await sendIssueTo(row.payload as unknown as Issue, recipients);
      // Store the count Resend acknowledged (ids.length), same as the worker,
      // so `recipients` means one thing on both write paths.
      await markIssueSent(date, ids.length, ids.join(","));
      await writeAudit(admin.id, "newsletter.resend", { type: "newsletter_issue", id: date }, { recipients: ids.length, confirmed: recipients.length });
      msg = `Reenviado para ${ids.length} de ${recipients.length} destinatários.`;
    } catch (err) {
      if (err instanceof PartialSendError) {
        await markIssueFailed(date, err.message, err.sentIds.join(","));
      } else {
        await markIssueFailed(date, err instanceof Error ? err.message : String(err));
      }
      await writeAudit(admin.id, "newsletter.resend_failed", { type: "newsletter_issue", id: date });
      msg = "Reenvio falhou.";
    }
  }
  revalidatePath(REDIRECT_PATH);
  withMsg(msg);
}

/**
 * Sends today's issue to one address, without inserting a row — the ONLY
 * manual send path (spec §5). Uses the existing row's payload when today
 * already has one, otherwise composes on the fly; either way nothing is
 * written to newsletter_issues.
 */
export async function testSend(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const email = normalizeEmail(formData.get("email"));
  let msg: string;
  if (!email) {
    msg = "Email inválido.";
  } else {
    const date = brtDate(new Date());
    const existing = await getIssue(date);
    const issue = existing ? (existing.payload as unknown as Issue) : await composeIssue(date);
    try {
      await sendIssueTo(issue, [{ email, token: "test" }]);
      await writeAudit(admin.id, "newsletter.test_send", { type: "newsletter_issue", id: date }, { email });
      msg = `Teste enviado para ${email}.`;
    } catch (err) {
      msg = `Falha no envio de teste: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  withMsg(msg);
}
