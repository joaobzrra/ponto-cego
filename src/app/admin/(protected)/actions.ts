"use server";

import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { destroySession, getSessionAdmin } from "@/lib/auth";

export async function logout() {
  const admin = await getSessionAdmin();
  if (admin) await writeAudit(admin.id, "admin.logout");
  await destroySession();
  redirect("/admin/login");
}
