import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import * as OTPAuth from "otpauth";
import { db, tables } from "@/db";
import type { PanelRole } from "@/db/schema";
import { clampAttemptFields, VerifyGate } from "./login-guard";
import { hashPassword, verifyPassword } from "./passwords";
import { defaultPathFor, sectionsForRole, type SectionKey } from "./roles";

const SESSION_COOKIE = "pc_admin";
const ENROLL_COOKIE = "pc_enroll";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h sliding
const ENROLL_TTL_MS = 10 * 60 * 1000; // 10 min to finish TOTP enrollment
const MAX_FAILED_ATTEMPTS = 8; // per IP, per window
// Per email the lock is deliberately loose: any hard per-email lock lets an
// anonymous caller lock the real admin out at will (8 bad posts every 15 min).
// TOTP already makes online password guessing worthless, so this bound only
// caps distributed guessing against one account (~400 tries/hour).
const MAX_FAILED_PER_EMAIL = 100;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s === "change-me") throw new Error("SESSION_SECRET is not configured");
  return s;
}

export { hashPassword, verifyPassword } from "./passwords";

// ---------- TOTP ----------

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function totpUri(email: string, secretBase32: string): string {
  return new OTPAuth.TOTP({
    issuer: "Ponto Cego",
    label: email,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  }).toString();
}

export function verifyTotp(secretBase32: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secretBase32) });
  return totp.validate({ token: token.replace(/\s/g, ""), window: 1 }) !== null;
}

// ---------- login rate limiting ----------

/**
 * Only X-Forwarded-For is trusted, and only because the proxy in front of us
 * (Caddy, deploy/caddy/Caddyfile) overwrites it with the real peer address.
 * cf-connecting-ip / x-real-ip are NOT set by Caddy and would arrive exactly
 * as the client sent them, letting an attacker pick their own rate-limit
 * bucket per request (security review 2026-09-02). Caddy also strips those
 * two before proxying, so this is belt and braces.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  if (process.env.TRUST_PROXY_HEADERS !== "1") return "untrusted-proxy";
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function isLoginRateLimited(ip: string, email: string): Promise<boolean> {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS);
  const [row] = await db
    .select({
      byIp: sql<number>`count(*) filter (where ${tables.loginAttempts.ip} = ${ip})`,
      byEmail: sql<number>`count(*) filter (where ${tables.loginAttempts.email} = ${email})`,
    })
    .from(tables.loginAttempts)
    .where(
      and(
        eq(tables.loginAttempts.success, false),
        gt(tables.loginAttempts.attemptedAt, since),
      ),
    );
  return Number(row.byIp) >= MAX_FAILED_ATTEMPTS || Number(row.byEmail) >= MAX_FAILED_PER_EMAIL;
}

export async function recordLoginAttempt(ip: string, email: string, success: boolean) {
  await db.insert(tables.loginAttempts).values({ ...clampAttemptFields(ip, email), success });
}

const verifyGate = new VerifyGate(4, 16);
let dummyHash: Promise<string> | null = null;

/**
 * argon2 verify behind a concurrency gate (see VerifyGate). `null` hash means
 * "no such account": a real verify still runs against a throwaway hash so the
 * response time does not reveal whether the email exists. Returns false when
 * the gate is saturated — the caller reports it as too many attempts.
 */
export async function verifyPasswordGated(
  passwordHash: string | null,
  password: string,
): Promise<{ ok: boolean; saturated: boolean }> {
  const release = await verifyGate.acquire();
  if (!release) return { ok: false, saturated: true };
  try {
    if (passwordHash === null) {
      dummyHash ??= hashPassword("not-a-real-account");
      await verifyPassword(await dummyHash, password);
      return { ok: false, saturated: false };
    }
    return { ok: await verifyPassword(passwordHash, password), saturated: false };
  } finally {
    release();
  }
}

// ---------- sessions ----------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(adminId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(tables.adminSessions).values({
    tokenHash: hashToken(token),
    adminId,
    expiresAt,
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export type AdminIdentity = { id: number; email: string; role: PanelRole };

/** Returns the logged-in panel user or null. Slides the session expiry. */
export async function getSessionAdmin(): Promise<AdminIdentity | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const now = new Date();
  const [row] = await db
    .select({
      adminId: tables.adminUsers.id,
      email: tables.adminUsers.email,
      role: tables.adminUsers.role,
      disabled: tables.adminUsers.disabled,
      expiresAt: tables.adminSessions.expiresAt,
    })
    .from(tables.adminSessions)
    .innerJoin(tables.adminUsers, eq(tables.adminUsers.id, tables.adminSessions.adminId))
    .where(
      and(eq(tables.adminSessions.tokenHash, tokenHash), gt(tables.adminSessions.expiresAt, now)),
    );
  if (!row || row.disabled) return null;
  // Sliding expiry: extend when under half TTL remains.
  if (row.expiresAt.getTime() - now.getTime() < SESSION_TTL_MS / 2) {
    await db
      .update(tables.adminSessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS), lastSeenAt: now })
      .where(eq(tables.adminSessions.tokenHash, tokenHash));
  }
  return { id: row.adminId, email: row.email, role: row.role };
}

/** Any logged-in panel user (the layout guard). Redirects to login. */
export async function requireUser(): Promise<AdminIdentity> {
  const user = await getSessionAdmin();
  if (!user) redirect("/admin/login");
  return user;
}

/**
 * Admin-role guard — every server action keeps calling this, so mutations
 * stay admin-only regardless of what sections a role can SEE. Non-admins are
 * bounced to their first visible section, never to a loop.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const user = await requireUser();
  if (user.role !== "admin") {
    redirect(defaultPathFor(await sectionsForRole(user.role)));
  }
  return user;
}

/** Page guard: logged in AND the user's role can see `section`. */
export async function requireSection(section: SectionKey): Promise<AdminIdentity> {
  const user = await requireUser();
  if (user.role === "admin") return user;
  const allowed = await sectionsForRole(user.role);
  if (!allowed.has(section)) redirect(defaultPathFor(allowed));
  return user;
}

/** Non-redirecting check for route handlers (e.g. the snapshot viewer). */
export async function sessionCanSee(section: SectionKey): Promise<boolean> {
  const user = await getSessionAdmin();
  if (!user) return false;
  if (user.role === "admin") return true;
  return (await sectionsForRole(user.role)).has(section);
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db
      .delete(tables.adminSessions)
      .where(eq(tables.adminSessions.tokenHash, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

// ---------- TOTP enrollment token (short-lived, HMAC-signed, no half-open sessions) ----------

function signEnrollPayload(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export async function setEnrollCookie(adminId: number) {
  const exp = Date.now() + ENROLL_TTL_MS;
  const payload = `${adminId}.${exp}`;
  const jar = await cookies();
  jar.set(ENROLL_COOKIE, `${payload}.${signEnrollPayload(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: ENROLL_TTL_MS / 1000,
  });
}

export async function getEnrollAdminId(): Promise<number | null> {
  const jar = await cookies();
  const raw = jar.get(ENROLL_COOKIE)?.value;
  if (!raw) return null;
  const [adminId, exp, sig] = raw.split(".");
  if (!adminId || !exp || !sig) return null;
  const expected = signEnrollPayload(`${adminId}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() > Number(exp)) return null;
  return Number(adminId);
}

export async function clearEnrollCookie() {
  (await cookies()).delete(ENROLL_COOKIE);
}
