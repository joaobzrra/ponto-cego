"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { writeAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";

/** Merge: every article of `from` moves to `into`; `from` kept for audit. */
export async function mergeClusters(formData: FormData) {
  const admin = await requireAdmin();
  const from = Number(formData.get("from"));
  const into = Number(formData.get("into"));
  if (!Number.isInteger(from) || !Number.isInteger(into) || from === into) return;
  await db
    .update(tables.articles)
    .set({ clusterId: into })
    .where(eq(tables.articles.clusterId, from));
  await db
    .update(tables.clusters)
    .set({ status: "merged", mergedInto: into })
    .where(eq(tables.clusters.id, from));
  await writeAudit(admin.id, "cluster.merge", { type: "cluster", id: from }, { into });
  revalidatePath("/admin/clusters");
}

/** Split: the article leaves its cluster into a fresh one of its own. */
export async function removeFromCluster(formData: FormData) {
  const admin = await requireAdmin();
  const articleId = Number(formData.get("articleId"));
  const [article] = await db
    .select({ id: tables.articles.id, title: tables.articles.title, clusterId: tables.articles.clusterId })
    .from(tables.articles)
    .where(eq(tables.articles.id, articleId));
  if (!article?.clusterId) return;
  const [fresh] = await db
    .insert(tables.clusters)
    .values({ title: article.title })
    .returning({ id: tables.clusters.id });
  await db
    .update(tables.articles)
    .set({ clusterId: fresh.id })
    .where(eq(tables.articles.id, articleId));
  await writeAudit(admin.id, "cluster.split_article", { type: "article", id: articleId }, {
    fromCluster: article.clusterId,
    toCluster: fresh.id,
  });
  revalidatePath("/admin/clusters");
}

export async function renameCluster(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim();
  if (!Number.isInteger(id) || !title) return;
  await db.update(tables.clusters).set({ title }).where(eq(tables.clusters.id, id));
  await writeAudit(admin.id, "cluster.rename", { type: "cluster", id }, { title });
  revalidatePath("/admin/clusters");
}

/** Destaque approval (spec §2: draft-by-AI, publish-by-human). */
export async function reviewDestaque(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  const decision = formData.get("decision") === "approved" ? "approved" : "rejected";
  await db
    .update(tables.destaqueDrafts)
    .set({ status: decision, reviewedBy: admin.id, reviewedAt: new Date() })
    .where(and(eq(tables.destaqueDrafts.id, id), eq(tables.destaqueDrafts.status, "draft")));
  await writeAudit(admin.id, `destaque.${decision}`, { type: "destaque_draft", id });
  revalidatePath("/admin/clusters");
  revalidatePath("/");
}
