import nodemailer from "nodemailer";

/**
 * Alerting is push, not pull (spec §5). Any SMTP provider works — Gmail app
 * password, Resend, etc. When SMTP is unconfigured (early dev), alerts are
 * logged to the worker console instead of silently dropped.
 */
export async function sendAlertEmail(subject: string, text: string): Promise<boolean> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_FROM, ALERT_TO } = process.env;
  if (!SMTP_HOST || !ALERT_TO) {
    console.log(`[mailer] SMTP not configured — alert suppressed: ${subject}\n${text}`);
    return false;
  }
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: Number(SMTP_PORT ?? 587) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  await transport.sendMail({
    from: ALERT_FROM ?? SMTP_USER,
    to: ALERT_TO,
    subject,
    text,
  });
  return true;
}
