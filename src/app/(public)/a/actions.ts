"use server";

import { and, eq, gte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { BANDS, type Band } from "@/db/schema";
import { anonSessionId, previewAllowed } from "@/lib/preview";

/**
 * The ONLY unauthenticated write on the site (spec §5/§9). Constraints:
 * - one vote per article per anonymous session (unique index, silently dropped
 *   on conflict);
 * - ≤30 votes per session per hour (anti-brigading cap);
 * - never touches the band — feedback lands in the Bias Correction Queue for
 *   human review, by design (spec §9 gaming risk).
 */
export type FeedbackState = {
  status: "idle" | "recorded" | "already-recorded" | "rate-limited" | "invalid";
};

export async function submitFeedback(
  _previous: FeedbackState,
  formData: FormData,
): Promise<FeedbackState> {
  if (!(await previewAllowed())) return { status: "invalid" };

  const articleId = Number(formData.get("articleId"));
  const direction = formData.get("direction") === "agree" ? "agree" : "disagree";
  if (!Number.isInteger(articleId)) return { status: "invalid" };

  // On disagree the reader points at the band they think is right (E3..D3;
  // NC is not offered — "isso não é política" is a rarer report deferred
  // post-MVP per Addendum §A2).
  const rawSuggestion = formData.get("suggestedBand");
  const suggestedBand =
    direction === "disagree" &&
    typeof rawSuggestion === "string" &&
    BANDS.includes(rawSuggestion as Band) &&
    rawSuggestion !== "NC"
      ? (rawSuggestion as Band)
      : null;

  const [article] = await db
    .select({ id: tables.articles.id, band: tables.articles.band, status: tables.articles.status })
    .from(tables.articles)
    .where(eq(tables.articles.id, articleId));
  // No label to dispute on NC/unclassified (Addendum 01 §A2).
  if (!article || article.status !== "published" || !article.band || article.band === "NC") {
    return { status: "invalid" };
  }

  const sessionId = await anonSessionId();

  const [{ recent }] = await db
    .select({ recent: sql<number>`count(*)` })
    .from(tables.feedback)
    .where(
      and(
        eq(tables.feedback.sessionId, sessionId),
        gte(tables.feedback.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    );
  if (Number(recent) >= 30) return { status: "rate-limited" };

  const inserted = await db
    .insert(tables.feedback)
    .values({ articleId, direction, sessionId, suggestedBand })
    .onConflictDoNothing()
    .returning({ id: tables.feedback.id });

  if (inserted.length === 0) return { status: "already-recorded" };

  // First-party analytics: the press itself, for funnel analysis. The VOTE
  // lives in feedback (deduped); the event stream just counts engagement.
  try {
    const [outletRow] = await db
      .select({ outletId: tables.articles.outletId })
      .from(tables.articles)
      .where(eq(tables.articles.id, articleId));
    await db.insert(tables.events).values({
      sessionId,
      type: "feedback",
      path: `/a/${articleId}`,
      articleId,
      outletId: outletRow?.outletId ?? null,
      band: article.band,
    });
  } catch {
    // métrica é melhor-esforço
  }

  revalidatePath(`/a/${articleId}`);
  revalidatePath("/");
  return { status: "recorded" };
}
