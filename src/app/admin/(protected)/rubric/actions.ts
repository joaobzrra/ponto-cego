"use server";

import { desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { writeAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { createRubricVersion } from "@/lib/rubric";

export type RubricFormState = { error?: string; ok?: string };

export async function publishRubric(
  _prev: RubricFormState,
  formData: FormData,
): Promise<RubricFormState> {
  const admin = await requireAdmin();
  const content = String(formData.get("content") ?? "").trim();
  const changeNote = String(formData.get("changeNote") ?? "").trim();
  if (content.length < 200) return { error: "Rubrica curta demais — isso não parece intencional." };
  if (!changeNote) return { error: "Descreva a mudança (change log obrigatório, spec §5)." };

  const created = await createRubricVersion(content, changeNote, admin.id);
  await writeAudit(admin.id, "rubric.publish", { type: "rubric", id: created.id }, {
    version: created.version,
    changeNote,
  });
  revalidatePath("/admin/rubric");
  return { ok: `Rubrica v${created.version} publicada e ativa. Rode a calibração para medir o drift.` };
}

export async function requestCalibrationRun(): Promise<void> {
  const admin = await requireAdmin();
  const [pending] = await db
    .select({ id: tables.calibrationRuns.id })
    .from(tables.calibrationRuns)
    .orderBy(desc(tables.calibrationRuns.id))
    .limit(1);
  // The worker executes pending runs on its next classifier cycle (≤5 min).
  const [run] = await db
    .insert(tables.calibrationRuns)
    .values({ triggeredBy: admin.id })
    .returning();
  await writeAudit(admin.id, "calibration.run_requested", { type: "calibration_run", id: run.id });
  void pending;
  revalidatePath("/admin/rubric");
}
