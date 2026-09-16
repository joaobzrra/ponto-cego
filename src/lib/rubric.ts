import { desc, eq, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { DEFAULT_RUBRIC_CHANGE_NOTE, DEFAULT_RUBRIC_CONTENT } from "./rubric-default";

export type Rubric = typeof tables.rubrics.$inferSelect;

/** Seeds rubric v1 from the bundled default when the table is empty. */
export async function ensureDefaultRubric(): Promise<void> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(tables.rubrics);
  if (Number(n) > 0) return;
  await db.insert(tables.rubrics).values({
    version: 1,
    content: DEFAULT_RUBRIC_CONTENT,
    changeNote: DEFAULT_RUBRIC_CHANGE_NOTE,
    active: true,
  });
}

export async function getActiveRubric(): Promise<Rubric | null> {
  await ensureDefaultRubric();
  const [rubric] = await db
    .select()
    .from(tables.rubrics)
    .where(eq(tables.rubrics.active, true))
    .orderBy(desc(tables.rubrics.version))
    .limit(1);
  return rubric ?? null;
}

/**
 * Rubric edits are append-only versions with a change note (spec §5). The new
 * version becomes active; prior versions stay for audit + drift comparison.
 */
export async function createRubricVersion(
  content: string,
  changeNote: string,
  adminId: number,
): Promise<Rubric> {
  const [latest] = await db
    .select({ version: tables.rubrics.version })
    .from(tables.rubrics)
    .orderBy(desc(tables.rubrics.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  await db.update(tables.rubrics).set({ active: false }).where(eq(tables.rubrics.active, true));
  const [created] = await db
    .insert(tables.rubrics)
    .values({ version, content, changeNote, createdBy: adminId, active: true })
    .returning();
  return created;
}
