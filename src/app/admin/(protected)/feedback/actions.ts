"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { writeAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";

/** Closes an article's queue item: marks its unreviewed feedback reviewed. */
export async function markFeedbackReviewed(formData: FormData) {
  const admin = await requireAdmin();
  const articleId = Number(formData.get("articleId"));
  if (!Number.isInteger(articleId)) return;
  await db
    .update(tables.feedback)
    .set({ reviewedAt: new Date(), reviewedBy: admin.id })
    .where(and(eq(tables.feedback.articleId, articleId), isNull(tables.feedback.reviewedAt)));
  await writeAudit(admin.id, "feedback.reviewed", { type: "article", id: articleId });
  revalidatePath("/admin/feedback");
}
