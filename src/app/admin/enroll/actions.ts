"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, tables } from "@/db";
import { writeAudit } from "@/lib/audit";
import {
  clearEnrollCookie,
  createSession,
  getEnrollAdminId,
  verifyTotp,
} from "@/lib/auth";

export type EnrollState = { error?: string };

export async function confirmEnrollment(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const adminId = await getEnrollAdminId();
  if (!adminId) redirect("/admin/login");

  const code = String(formData.get("code") ?? "").trim();
  const [admin] = await db
    .select()
    .from(tables.adminUsers)
    .where(eq(tables.adminUsers.id, adminId));

  // Re-enrollment of an already-enrolled account is CLI-only (no email reset, spec §5).
  if (!admin || admin.disabled || admin.totpEnabled || !admin.totpSecret) {
    redirect("/admin/login");
  }

  if (!verifyTotp(admin.totpSecret, code)) {
    return { error: "Código inválido. Confira o app autenticador." };
  }

  await db
    .update(tables.adminUsers)
    .set({ totpEnabled: true })
    .where(eq(tables.adminUsers.id, adminId));
  await clearEnrollCookie();
  await createSession(adminId);
  await writeAudit(adminId, "admin.totp_enrolled");
  redirect("/admin");
}
