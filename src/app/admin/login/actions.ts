"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, tables } from "@/db";
import { writeAudit } from "@/lib/audit";
import {
  createSession,
  getClientIp,
  isLoginRateLimited,
  recordLoginAttempt,
  setEnrollCookie,
  verifyPasswordGated,
  verifyTotp,
} from "@/lib/auth";

// One message for every credential failure (unknown email, wrong password,
// wrong TOTP) so a caller cannot learn which half was right.
const INVALID = "Credenciais inválidas.";
const TOO_MANY = "Muitas tentativas. Aguarde 15 minutos.";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  if (!email || !password) return { error: "Informe e-mail e senha." };

  const ip = await getClientIp();
  if (await isLoginRateLimited(ip, email)) {
    return { error: TOO_MANY };
  }

  const [admin] = await db
    .select()
    .from(tables.adminUsers)
    .where(eq(tables.adminUsers.email, email));

  // Unknown or disabled accounts still pay for a verify against a dummy hash,
  // so timing does not enumerate emails; the gate bounds concurrent verifies.
  const usable = admin && !admin.disabled ? admin : null;
  const { ok: passwordOk, saturated } = await verifyPasswordGated(
    usable ? usable.passwordHash : null,
    password,
  );
  if (saturated) return { error: TOO_MANY };
  if (!usable || !passwordOk) {
    await recordLoginAttempt(ip, email, false);
    return { error: INVALID };
  }

  // First login: password OK but TOTP not yet enrolled → forced enrollment.
  if (!admin.totpEnabled) {
    await recordLoginAttempt(ip, email, true);
    await setEnrollCookie(admin.id);
    redirect("/admin/enroll");
  }

  if (!code || !verifyTotp(admin.totpSecret!, code)) {
    await recordLoginAttempt(ip, email, false);
    return { error: INVALID };
  }

  await recordLoginAttempt(ip, email, true);
  await createSession(admin.id);
  await writeAudit(admin.id, "admin.login");
  redirect("/admin");
}
