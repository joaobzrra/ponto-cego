"use server";

import { randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { PANEL_ROLES, type PanelRole } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { GRANTABLE_SECTIONS } from "@/lib/roles";

/*
 * User management (2026-07-20). Rules that keep this safe:
 * - every action requires the admin ROLE (requireAdmin is strict now);
 * - no self-demotion / self-disable (an admin can't lock themselves out);
 * - the last enabled admin can never be demoted or disabled;
 * - temp passwords are generated server-side, shown exactly once, and only
 *   their hash is stored — same discipline as scripts/seed-admin.ts;
 * - everything lands in audit_log.
 */

export type UserActionState = { error?: string; tempPassword?: string; email?: string };

const tempPassword = () => randomBytes(12).toString("base64url");

function parseRole(raw: unknown): PanelRole | null {
  return PANEL_ROLES.includes(raw as PanelRole) ? (raw as PanelRole) : null;
}

/** True when `id` is the only enabled admin left. */
async function isLastAdmin(id: number): Promise<boolean> {
  const [row] = await db
    .select({ id: tables.adminUsers.id })
    .from(tables.adminUsers)
    .where(
      and(
        eq(tables.adminUsers.role, "admin"),
        eq(tables.adminUsers.disabled, false),
        ne(tables.adminUsers.id, id),
      ),
    )
    .limit(1);
  return row === undefined;
}

export async function createUser(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const admin = await requireAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = parseRole(formData.get("role"));
  if (!email.includes("@")) return { error: "E-mail inválido." };
  if (!role) return { error: "Papel inválido." };

  const [existing] = await db
    .select({ id: tables.adminUsers.id })
    .from(tables.adminUsers)
    .where(eq(tables.adminUsers.email, email));
  if (existing) return { error: "Já existe um usuário com esse e-mail." };

  const password = tempPassword();
  const [created] = await db
    .insert(tables.adminUsers)
    .values({ email, role, passwordHash: await hashPassword(password) })
    .returning({ id: tables.adminUsers.id });
  await writeAudit(admin.id, "user.created", { type: "admin_user", id: created.id }, { role });
  revalidatePath("/admin/usuarios");
  return { tempPassword: password, email };
}

export async function updateRole(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  const role = parseRole(formData.get("role"));
  if (!Number.isInteger(id) || !role) return;
  // No self-demotion; demoting anyone ELSE is safe because the acting admin
  // remains an enabled admin.
  if (id === admin.id) return;
  await db.update(tables.adminUsers).set({ role }).where(eq(tables.adminUsers.id, id));
  await writeAudit(admin.id, "user.role_changed", { type: "admin_user", id }, { role });
  revalidatePath("/admin/usuarios");
}

export async function toggleDisabled(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  if (id === admin.id) return; // no self-disable
  const [user] = await db
    .select({ disabled: tables.adminUsers.disabled, role: tables.adminUsers.role })
    .from(tables.adminUsers)
    .where(eq(tables.adminUsers.id, id));
  if (!user) return;
  if (!user.disabled && user.role === "admin" && (await isLastAdmin(id))) return;
  await db
    .update(tables.adminUsers)
    .set({ disabled: !user.disabled })
    .where(eq(tables.adminUsers.id, id));
  // Disabling also kills any live sessions immediately.
  if (!user.disabled) {
    await db.delete(tables.adminSessions).where(eq(tables.adminSessions.adminId, id));
  }
  await writeAudit(admin.id, user.disabled ? "user.enabled" : "user.disabled", {
    type: "admin_user",
    id,
  });
  revalidatePath("/admin/usuarios");
}

export async function resetTotp(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await db
    .update(tables.adminUsers)
    .set({ totpSecret: null, totpEnabled: false })
    .where(eq(tables.adminUsers.id, id));
  // A reset is an incident-response step: a stolen session must not outlive it.
  await db.delete(tables.adminSessions).where(eq(tables.adminSessions.adminId, id));
  await writeAudit(admin.id, "user.totp_reset", { type: "admin_user", id });
  revalidatePath("/admin/usuarios");
}

export async function resetPassword(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return { error: "Usuário inválido." };
  const [user] = await db
    .select({ email: tables.adminUsers.email })
    .from(tables.adminUsers)
    .where(eq(tables.adminUsers.id, id));
  if (!user) return { error: "Usuário não encontrado." };
  const password = tempPassword();
  await db
    .update(tables.adminUsers)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(tables.adminUsers.id, id));
  await db.delete(tables.adminSessions).where(eq(tables.adminSessions.adminId, id));
  await writeAudit(admin.id, "user.password_reset", { type: "admin_user", id });
  revalidatePath("/admin/usuarios");
  return { tempPassword: password, email: user.email };
}

/**
 * Saves the whole role × section matrix in one shot. Checkbox names are
 * `perm:<role>:<section>`; anything unchecked is revoked. Admin is implicit
 * and "usuarios" is not grantable — both enforced here, not just in the UI.
 */
export async function savePermissions(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const grantable = new Set(GRANTABLE_SECTIONS.map((s) => s.key));
  const editableRoles = PANEL_ROLES.filter((r) => r !== "admin");

  const grants: Array<{ role: PanelRole; section: string }> = [];
  for (const key of formData.keys()) {
    const m = /^perm:([^:]+):(.+)$/.exec(key);
    if (!m) continue;
    const role = parseRole(m[1]);
    if (!role || role === "admin") continue;
    if (!grantable.has(m[2] as (typeof GRANTABLE_SECTIONS)[number]["key"])) continue;
    grants.push({ role, section: m[2] });
  }

  await db.transaction(async (tx) => {
    for (const role of editableRoles) {
      await tx.delete(tables.rolePermissions).where(eq(tables.rolePermissions.role, role));
    }
    if (grants.length > 0) {
      await tx.insert(tables.rolePermissions).values(grants);
    }
  });
  await writeAudit(admin.id, "permissions.saved", undefined, {
    grants: grants.map((g) => `${g.role}:${g.section}`),
  });
  revalidatePath("/admin/usuarios");
  revalidatePath("/admin");
}
