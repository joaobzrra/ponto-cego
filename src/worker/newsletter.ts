/*
 * Daily send (spec 2026-09-04 §3). Guard: past NEWSLETTER_SEND_HOUR in BRT and
 * no newsletter_issues row for today's BRT date. The insert is the lock: two
 * workers racing insert once, and only the one whose insert returned a row
 * proceeds to send. Everything the email says was composed BEFORE the insert.
 *
 * Fix round 1 (review): a missing RESEND_API_KEY must not burn the day (no
 * row written, next tick retries — checked before compose and before the
 * insert lock); a partial batch failure must not lose the ids already sent
 * (PartialSendError carries them into markIssueFailed's providerRef); zero
 * confirmed subscribers is a skip, not a send, but still holds the day's lock.
 */
import {
  NEWSLETTER_ENABLED,
  NEWSLETTER_SEND_HOUR,
  claimIssueForSend,
  composeIssue,
  confirmedSubscribers,
  getIssue,
  markIssueFailed,
  markIssueSent,
  markIssueSkipped,
} from "@/lib/newsletter";
import { renderIssueHtml, renderIssueText, subjectFor } from "@/lib/newsletter-render";
import { brtDate, brtHour, issueIsEmpty, type Issue } from "@/lib/newsletter-rules";
import { sendBatch, type OutgoingEmail } from "@/lib/resend";
import { siteUrl } from "@/lib/seo";

/**
 * Compose backoff: `composeIssue` runs a dozen heavy queries, and the tick
 * repeats every 30s — a compose that throws (a bad payload, a dead DB) would
 * otherwise be retried 120 times an hour, all day. After a throw the stage
 * idles for 10 minutes. Module-level, so it resets on a worker restart.
 */
const COMPOSE_BACKOFF_MS = 10 * 60 * 1000;
let lastComposeFailureAt = 0;

async function composeOrBackoff(date: string): Promise<Issue> {
  try {
    return await composeIssue(date);
  } catch (err) {
    lastComposeFailureAt = Date.now();
    throw err;
  }
}

export class PartialSendError extends Error {
  constructor(
    message: string,
    public sentIds: string[],
  ) {
    super(message);
    this.name = "PartialSendError";
  }
}

function messagesFor(issue: Issue, recipients: Array<{ email: string; token: string }>): OutgoingEmail[] {
  const base = siteUrl();
  const viewUrl = `${base}/newsletter/${issue.date}`;
  const subject = subjectFor(issue);
  return recipients.map(({ email, token }) => {
    // The admin test send uses the sentinel token "test": there is no
    // subscriber row behind it, so a one-click unsubscribe would 404 (or, in a
    // mailbox that pre-fetches List-Unsubscribe, look like a broken list). The
    // test message therefore carries no List-Unsubscribe headers and links to
    // the public page instead of a per-recipient token URL.
    const isTest = token === "test";
    const unsubscribeUrl = isTest ? `${base}/newsletter` : `${base}/newsletter/sair?t=${token}`;
    const oneClick = `${base}/api/newsletter/unsubscribe?t=${token}`;
    const opts = { siteUrl: base, unsubscribeUrl, viewUrl };
    const headers: Record<string, string> | undefined = isTest
      ? undefined
      : {
          "List-Unsubscribe": `<${oneClick}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        };
    return {
      to: email,
      subject,
      html: renderIssueHtml(issue, opts),
      text: renderIssueText(issue, opts),
      headers,
    };
  });
}

/** Throws PartialSendError (carrying the ids already sent) if a later batch fails. */
export async function sendIssueTo(issue: Issue, recipients: Array<{ email: string; token: string }>): Promise<{ ids: string[] }> {
  const ids: string[] = [];
  const msgs = messagesFor(issue, recipients);
  for (let i = 0; i < msgs.length; i += 100) {
    // Pace the batches so a large list does not hit Resend's rate limit. No
    // retry: a 429 still fails the batch and PartialSendError keeps the ids
    // already accepted.
    if (i > 0) await new Promise((r) => setTimeout(r, 250));
    try {
      const r = await sendBatch(msgs.slice(i, i + 100));
      ids.push(...r.ids);
    } catch (err) {
      throw new PartialSendError(err instanceof Error ? err.message : String(err), ids);
    }
  }
  return { ids };
}

export async function runNewsletterCycle(
  now: Date = new Date(),
): Promise<{ action: "idle" | "skipped" | "sent" | "failed"; date: string; recipients?: number; reason?: string }> {
  const date = brtDate(now);
  if (!NEWSLETTER_ENABLED) return { action: "idle", date };
  if (brtHour(now) < NEWSLETTER_SEND_HOUR) return { action: "idle", date };
  // A `preview` row is an admin dry run, not the day's issue: it must NOT stop
  // the 7h send. Every other status means the day is already claimed.
  const existing = await getIssue(date);
  if (existing && existing.status !== "preview") return { action: "idle", date };
  // Pre-flight, before compose and before the insert lock: a missing key must
  // not burn the day — no row is written, so the next tick retries (spec §3).
  if (!process.env.RESEND_API_KEY) return { action: "idle", date, reason: "no-key" };
  if (Date.now() - lastComposeFailureAt < COMPOSE_BACKOFF_MS) {
    return { action: "idle", date, reason: "compose-backoff" };
  }

  const issue = await composeOrBackoff(date);
  const base = siteUrl();
  const html = renderIssueHtml(issue, { siteUrl: base, unsubscribeUrl: `${base}/newsletter`, viewUrl: `${base}/newsletter/${date}` });
  const empty = issueIsEmpty(issue);
  // The claim is the lock (it also takes over a preview row); only the caller
  // whose statement returned a row goes on to send.
  const claimed = await claimIssueForSend(date, issue, html, empty ? "skipped" : "composed");
  if (!claimed || empty) return { action: claimed ? "skipped" : "idle", date };

  try {
    const recipients = await confirmedSubscribers();
    if (recipients.length === 0) {
      await markIssueSkipped(date);
      return { action: "skipped", date, recipients: 0 };
    }
    const { ids } = await sendIssueTo(issue, recipients);
    // The acknowledged count, not the attempted one: `recipients` on the row
    // must equal what Resend accepted, so the launch check "recipients equals
    // the confirmed count" actually proves the send landed.
    await markIssueSent(date, ids.length, ids.join(","));
    return { action: "sent", date, recipients: ids.length };
  } catch (err) {
    if (err instanceof PartialSendError) {
      await markIssueFailed(date, err.message, err.sentIds.join(","));
    } else {
      await markIssueFailed(date, err instanceof Error ? err.message : String(err));
    }
    return { action: "failed", date };
  }
}
