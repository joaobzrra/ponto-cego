import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { db, tables } from "@/db";
import { generateTotpSecret, getEnrollAdminId, totpUri } from "@/lib/auth";
import "../admin.css";
import { EnrollForm } from "./enroll-form";

export const metadata = { title: "Ponto Cego — Ativar TOTP" };

export default async function EnrollPage() {
  const adminId = await getEnrollAdminId();
  if (!adminId) redirect("/admin/login");

  const [admin] = await db
    .select()
    .from(tables.adminUsers)
    .where(eq(tables.adminUsers.id, adminId));
  if (!admin || admin.disabled || admin.totpEnabled) redirect("/admin/login");

  // Generate + persist the secret on first visit; reuse it on refresh so the
  // QR the user already scanned stays valid.
  let secret = admin.totpSecret;
  if (!secret) {
    secret = generateTotpSecret();
    await db
      .update(tables.adminUsers)
      .set({ totpSecret: secret })
      .where(eq(tables.adminUsers.id, adminId));
  }

  const qrDataUrl = await QRCode.toDataURL(totpUri(admin.email, secret), {
    margin: 1,
    width: 220,
  });

  return (
    <div className="card auth-card">
      <h1 style={{ fontWeight: 300, letterSpacing: "0.2em", fontSize: "1.1rem" }}>
        ATIVAR TOTP
      </h1>
      <p className="muted">
        TOTP é obrigatório para contas admin. Escaneie no seu app autenticador
        (Aegis, Google Authenticator, 1Password…) e confirme com um código.
      </p>
      {/* QR must stay scannable — exempt from the greyscale rule via explicit filter reset */}
      <img
        src={qrDataUrl}
        alt="QR code TOTP"
        width={220}
        height={220}
        style={{ background: "#fff", borderRadius: 4, filter: "none" }}
      />
      <p className="muted mono" style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>
        Segredo manual: {secret}
      </p>
      <EnrollForm />
    </div>
  );
}
