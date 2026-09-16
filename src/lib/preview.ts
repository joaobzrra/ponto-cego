import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

const PREVIEW_COOKIE = "pc_preview";
const SESSION_COOKIE = "pc_sess";
const YEAR_S = 365 * 24 * 60 * 60;

function accessCode(): string {
  return process.env.PREVIEW_ACCESS_CODE ?? "";
}

/**
 * Calibration-period gate (spec §10: the pipeline runs privately before
 * launch). Disabled automatically when PREVIEW_ACCESS_CODE is unset — that's
 * the eventual public-launch switch.
 */
export async function previewAllowed(): Promise<boolean> {
  const code = accessCode();
  if (!code) return true;
  const store = await cookies();
  return store.get(PREVIEW_COOKIE)?.value === code;
}

/**
 * Anonymized reader session (spec §7/§9): a random id in an httpOnly cookie,
 * used only to rate-limit feedback. Never linked to any identity; no IP kept.
 */
/**
 * Read-only variant for page renders (which may not set cookies): returns the
 * existing session id or null. The /api/e beacon mints the cookie on the
 * visitor's first page, so a null here is rare (first-ever request only).
 */
export async function readAnonSessionId(): Promise<string | null> {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  return existing && /^[a-f0-9]{32}$/.test(existing) ? existing : null;
}

export async function anonSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
  const id = randomBytes(16).toString("hex");
  store.set(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: YEAR_S,
    path: "/",
  });
  return id;
}
