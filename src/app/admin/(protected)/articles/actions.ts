"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { BANDS, type Band } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";

/**
 * Manual scope correction (Addendum 01 §A1): a human asserting an article is
 * political (or not) regardless of which feed delivered it. Audited — the
 * audit row is what distinguishes a manual override from a poller-set scope.
 * Note: the poller only ever upgrades geral→politica (never downgrades), so a
 * manual politica→geral flip can be re-upgraded while the article is still in
 * a política feed's window; both events land in the audit log.
 */
export async function setArticleScope(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  const scope = formData.get("scope") === "politica" ? "politica" : "geral";
  const [article] = await db
    .select({ feedScope: tables.articles.feedScope })
    .from(tables.articles)
    .where(eq(tables.articles.id, id));
  if (!article || article.feedScope === scope) return;
  await db.update(tables.articles).set({ feedScope: scope }).where(eq(tables.articles.id, id));
  await writeAudit(admin.id, "article.set_scope", { type: "article", id }, {
    from: article.feedScope,
    to: scope,
  });
  revalidatePath("/admin/articles");
}

/**
 * Manual band override incl. NC↔banded (Addendum 01 §A2 / spec §5 Bias
 * Correction): audited like any override; rubricVersion/modelId stay as the
 * model left them so the audit row is the marker of human correction.
 */
export async function setArticleBand(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  const band = String(formData.get("band"));
  if (!BANDS.includes(band as Band)) return;
  const [article] = await db
    .select({ band: tables.articles.band })
    .from(tables.articles)
    .where(eq(tables.articles.id, id));
  if (!article || article.band === band) return;
  await db
    .update(tables.articles)
    .set({ band: band as Band, classifyStatus: "classified", classifiedAt: new Date() })
    .where(eq(tables.articles.id, id));
  await writeAudit(admin.id, "article.set_band", { type: "article", id }, {
    from: article.band,
    to: band,
  });
  revalidatePath("/admin/articles");
}

/** Adds an article to the calibration set with its current/expected band. */
export async function addToCalibration(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  const expectedBand = String(formData.get("expectedBand"));
  if (!BANDS.includes(expectedBand as Band)) return;
  const [article] = await db.select().from(tables.articles).where(eq(tables.articles.id, id));
  if (!article) return;
  const [item] = await db
    .insert(tables.calibrationArticles)
    .values({
      articleId: article.id,
      url: article.canonicalUrl,
      title: article.title,
      expectedBand: expectedBand as Band,
      addedBy: admin.id,
    })
    .returning();
  await writeAudit(admin.id, "calibration.add_article", { type: "calibration_article", id: item.id }, {
    articleId: article.id,
    expectedBand,
  });
  revalidatePath("/admin/articles");
  revalidatePath("/admin/rubric");
}

/** Takedown path (spec §3.3): immediate unpublish, audited, reversible. */
export async function setArticleStatus(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  const status = formData.get("status") === "unpublished" ? "unpublished" : "published";
  await db.update(tables.articles).set({ status }).where(eq(tables.articles.id, id));
  await writeAudit(
    admin.id,
    status === "unpublished" ? "article.unpublish" : "article.republish",
    { type: "article", id },
  );
  revalidatePath("/admin/articles");
}
