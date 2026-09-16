/**
 * Destaque do Dia — data access for the daily aggregate synthesis (spec §2).
 *
 * HARD RULE (v2 "draft-by-AI, publish-by-human"): only an admin-approved
 * synthesis is ever returned. Stage 7 adds the drafting pipeline and the
 * approval flow; until then this returns null and the front page simply
 * renders no hero. The component contract is stable so stage 7 only has to
 * fill in this function.
 */
import type { DistributionCounts } from "@/components/bias";

export type ApprovedDestaque = {
  /** Underlying cluster — lets the front page exclude it from other sections. */
  clusterId: number | null;
  /** Neutral aggregate headline for the day's central fact. */
  title: string;
  /** Human-approved synthesis describing the aggregate event across sources. */
  synthesis: string;
  /** Number of distinct sources covering the underlying cluster. */
  sourceCount: number;
  /** Spectrum distribution of the cluster's coverage, for the hero bar. */
  distribution: DistributionCounts | null;
  approvedAt: Date;
};

export async function getApprovedDestaque(): Promise<ApprovedDestaque | null> {
  const { db, tables } = await import("@/db");
  const { desc, eq } = await import("drizzle-orm");
  const [row] = await db
    .select()
    .from(tables.destaqueDrafts)
    .where(eq(tables.destaqueDrafts.status, "approved"))
    .orderBy(desc(tables.destaqueDrafts.reviewedAt))
    .limit(1);
  if (!row) return null;
  // Only today's or yesterday's approval leads the page (spec §2: the hero
  // shows the previous day's approved item at most).
  if (row.reviewedAt && Date.now() - row.reviewedAt.getTime() > 48 * 60 * 60 * 1000) {
    return null;
  }
  return {
    clusterId: row.clusterId ?? null,
    title: row.draftTitle,
    synthesis: row.draftSynthesis,
    sourceCount: row.sourceCount,
    distribution: null,
    approvedAt: row.reviewedAt ?? row.createdAt,
  };
}
