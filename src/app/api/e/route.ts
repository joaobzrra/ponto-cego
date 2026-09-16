import { and, eq, gte, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db, tables } from "@/db";
import { getClientIp } from "@/lib/auth";
import { allowEvent } from "@/lib/event-budget";
import { readBodyCapped } from "@/lib/http";
import { anonSessionId } from "@/lib/preview";

/**
 * First-party analytics ingestion (the site's first API route). Receives
 * pageview/clickout beacons from the browser via fetch(..., {keepalive:true})
 * — NOT sendBeacon, so the Set-Cookie minting pc_sess for first-time visitors
 * is honored. search/feedback events are written server-side where they
 * happen and are NOT accepted here.
 *
 * Privacy contract (/privacidade + schema §7): pseudonymous session id only,
 * no IP, and the user-agent string is inspected for bot/device class then
 * DISCARDED — never stored.
 */

const HOUR_MS = 60 * 60 * 1000;
const MAX_EVENTS_PER_HOUR = 240;
const MAX_BODY_BYTES = 4 * 1024;

const BOT_RE =
  /bot|crawl|spider|slurp|headless|lighthouse|pingdom|preview|facebookexternal|whatsapp|telegram|curl|wget|python-requests|axios|node-fetch/i;

type Payload = {
  type?: unknown;
  path?: unknown;
  ref?: unknown;
  utm?: { source?: unknown; medium?: unknown; campaign?: unknown };
  articleId?: unknown;
};

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
}

/** Referrers reduce to a hostname; same-site and garbage become null. */
function referrerHost(v: unknown, selfHost: string): string | null {
  const raw = str(v, 500);
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host && host !== selfHost ? host.slice(0, 100) : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  // Budgets the client cannot reset (per IP + global) run BEFORE any work.
  // The IP lives in process memory only and is never written (privacy §7).
  // getClientIp() returns a constant without TRUST_PROXY_HEADERS, which then
  // collapses to one shared bucket — acceptable, and the VPS sets it.
  if (!allowEvent(await getClientIp())) {
    return NextResponse.json({ error: "limite" }, { status: 429 });
  }

  // A beacon is a few hundred bytes. Cap while reading: request.json() has no
  // limit of its own and Content-Length is optional (security audit 2026-09-04).
  let body: Payload;
  try {
    const raw = await readBodyCapped(request, MAX_BODY_BYTES);
    body = JSON.parse(raw.toString("utf8")) as Payload;
  } catch {
    return NextResponse.json({ error: "json inválido" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "json inválido" }, { status: 400 });
  }

  const type = str(body.type, 16);
  if (type !== "pageview" && type !== "clickout") {
    return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
  }

  const path = str(body.path, 200);
  if (!path || !path.startsWith("/") || path.startsWith("/admin") || path.startsWith("/api")) {
    return NextResponse.json({ error: "path inválido" }, { status: 400 });
  }

  // UA → bot flag + coarse device class, then the string is dropped.
  const ua = request.headers.get("user-agent") ?? "";
  const isBot = ua === "" || BOT_RE.test(ua);
  const device = /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop";

  const sessionId = await anonSessionId();

  // Same shape as the feedback vote cap: a cheap count over the indexed
  // (session_id, created_at) prefix.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(tables.events)
    .where(
      and(
        eq(tables.events.sessionId, sessionId),
        gte(tables.events.createdAt, new Date(Date.now() - HOUR_MS)),
      ),
    );
  if (Number(n) >= MAX_EVENTS_PER_HOUR) {
    return NextResponse.json({ error: "limite por sessão" }, { status: 429 });
  }

  let articleId: number | null = null;
  let outletId: number | null = null;
  let band: string | null = null;
  if (type === "clickout") {
    const idNum = Number(body.articleId);
    if (!Number.isInteger(idNum)) {
      return NextResponse.json({ error: "articleId inválido" }, { status: 400 });
    }
    const [article] = await db
      .select({ outletId: tables.articles.outletId, band: tables.articles.band })
      .from(tables.articles)
      .where(eq(tables.articles.id, idNum))
      .limit(1);
    if (!article) return NextResponse.json({ error: "artigo desconhecido" }, { status: 400 });
    articleId = idNum;
    outletId = article.outletId;
    band = article.band;
  }

  const selfHost = request.headers.get("host")?.toLowerCase().split(":")[0] ?? "";
  await db.insert(tables.events).values({
    sessionId,
    type,
    path,
    articleId,
    outletId,
    band,
    referrerHost: type === "pageview" ? referrerHost(body.ref, selfHost) : null,
    utmSource: str(body.utm?.source, 80)?.toLowerCase() ?? null,
    utmMedium: str(body.utm?.medium, 80)?.toLowerCase() ?? null,
    utmCampaign: str(body.utm?.campaign, 80)?.toLowerCase() ?? null,
    device,
    isBot,
  });

  return NextResponse.json({ ok: true });
}
