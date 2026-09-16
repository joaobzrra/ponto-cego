/*
 * Newsletter data layer (spec 2026-09-04). composeIssue is deterministic for a
 * given date + database state: every query orders with a full tie-break and
 * the only clock input is the date's window. The pure rules are in
 * lib/newsletter-rules.ts; rendering in lib/newsletter-render.ts.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { type Blindspot } from "@/lib/blindspots";
import { briefingLinesFor } from "@/lib/briefing";
import { cardEligible, cardTitle } from "@/lib/card-eligibility";
import { subnoticiados } from "@/lib/classification";
import { briefingHeads } from "@/lib/home";
import {
  categoryOrder,
  issueUrl,
  pickBlindspots,
  pickSecondBlindspot,
  type Issue,
  type IssueItem,
  type IssueSides,
} from "@/lib/newsletter-rules";
import { siteUrl } from "@/lib/seo";

export const NEWSLETTER_ENABLED = process.env.NEWSLETTER_ENABLED === "1";
const sendHourEnv = Number(process.env.NEWSLETTER_SEND_HOUR ?? 7);
export const NEWSLETTER_SEND_HOUR = Number.isInteger(sendHourEnv) && sendHourEnv >= 0 && sendHourEnv <= 23 ? sendHourEnv : 7;
export const FROM_ADDRESS = "Ponto Cego <newsletter@pontocego.app>";
export const REPLY_TO = "contato@pontocego.app";

export type IssueRow = typeof tables.newsletterIssues.$inferSelect;

/* ---------- headline + sides per cluster ---------- */

type Face = { clusterId: number; headline: string; outlet: string; sides: IssueSides };

/**
 * For each cluster: the earliest published article from an outlet WITHOUT a
 * warning label (ledger CLM-flagged-outlet-never-fronts-a-card — a flagged
 * outlet never supplies the headline), and distinct outlets per side. Uses
 * `cardEligible` (card-eligibility.ts) as a WHERE predicate, not a sort key —
 * a cluster with no eligible article yields no `m` row at all, so it drops
 * out of the map and `item()`'s null path removes it from the issue, the
 * same as `clusterHasFace` does for the home page. The headline comes from
 * `cardTitle` (same file) so the email headline always equals the site's
 * card headline, not the cluster's raw (possibly flagged-outlet-seeded) title.
 */
async function facesFor(clusterIds: number[]): Promise<Map<number, Face>> {
  const out = new Map<number, Face>();
  if (clusterIds.length === 0) return out;
  const r = await db.execute(sql`
    with m as (
      select a.cluster_id, o.name as outlet,
             row_number() over (
               partition by a.cluster_id
               order by coalesce(a.published_at, a.fetched_at) asc, a.id asc
             ) as rn
      from articles a join outlets o on o.id = a.outlet_id
      where a.cluster_id in (${sql.join(clusterIds.map((id) => sql`${id}`), sql`, `)})
        and a.status = 'published' and a.duplicate_of is null
        and ${cardEligible("a")}
    ),
    sides as (
      select a.cluster_id,
             count(distinct a.outlet_id) filter (where a.band in ('E3','E2','E1'))::int as e,
             count(distinct a.outlet_id) filter (where a.band = 'C')::int as c,
             count(distinct a.outlet_id) filter (where a.band in ('D1','D2','D3'))::int as d
      from articles a
      where a.cluster_id in (${sql.join(clusterIds.map((id) => sql`${id}`), sql`, `)})
        and a.status = 'published' and a.duplicate_of is null
      group by a.cluster_id
    )
    select m.cluster_id, ${cardTitle("cl")} as title, m.outlet, s.e, s.c, s.d
    from m
    join clusters cl on cl.id = m.cluster_id
    join sides s on s.cluster_id = m.cluster_id
    where m.rn = 1
  `);
  for (const row of r.rows as Array<{ cluster_id: number; title: string; outlet: string; e: number; c: number; d: number }>) {
    out.set(row.cluster_id, {
      clusterId: row.cluster_id, headline: row.title, outlet: row.outlet,
      sides: { esquerda: row.e, centro: row.c, direita: row.d },
    });
  }
  return out;
}

/* ---------- least covered in a category (spec §1 rule 3) ---------- */

async function leastCoveredInCategory(category: string, exclude: Set<number>): Promise<number | null> {
  const ex = exclude.size ? sql`and c.id not in (${sql.join([...exclude].map((id) => sql`${id}`), sql`, `)})` : sql``;
  const r = await db.execute(sql`
    with cat as (
      select a.cluster_id, mode() within group (order by a.category) as category
      from articles a
      where a.cluster_id is not null and a.status = 'published' and a.duplicate_of is null
        and a.band is not null and a.band <> 'NC' and a.category is not null
        and a.fetched_at > now() - interval '24 hours'
      group by a.cluster_id
    )
    select c.id,
           count(distinct a.outlet_id) filter (where a.band is not null and a.band <> 'NC')::int as outlets,
           count(*) filter (where a.band is not null and a.band <> 'NC')::int as arts
    from clusters c
    join cat on cat.cluster_id = c.id and cat.category = ${category}
    join articles a on a.cluster_id = c.id and a.status = 'published' and a.duplicate_of is null
    where c.status = 'active' ${ex}
    group by c.id
    having count(distinct a.outlet_id) filter (where a.band is not null and a.band <> 'NC') >= 2
    order by outlets asc, arts asc, c.id asc
    limit 1
  `);
  const row = (r.rows as Array<{ id: number }>)[0];
  return row ? row.id : null;
}

/* ---------- compose ---------- */

async function recentBlindspotIds(date: string): Promise<Set<number>> {
  const rows = await db
    .select({ payload: tables.newsletterIssues.payload })
    .from(tables.newsletterIssues)
    .where(sql`${tables.newsletterIssues.date} < ${date} and ${tables.newsletterIssues.date} >= to_char((${date}::date - interval '7 days'), 'YYYY-MM-DD')`);
  const ids = new Set<number>();
  for (const r of rows) {
    const p = r.payload as Partial<Issue>;
    if (p.top?.clusterId) ids.add(p.top.clusterId);
    if (p.second?.clusterId) ids.add(p.second.clusterId);
  }
  return ids;
}

export async function composeIssue(date: string): Promise<Issue> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("composeIssue: date must be YYYY-MM-DD");
  const base = siteUrl();
  const used = new Set<number>();

  // 1: top blindspot, from the home's exact ranking, 7-day no-repeat.
  // subnoticiados() already calls rankBlindspots internally (classification.ts)
  // and returns the ranked, one-per-subject Blindspot[] — calling rankBlindspots
  // again here would just re-sort an already-sorted array, so it is skipped.
  const ranked: Blindspot[] = await subnoticiados({ days: 7 });
  const recentIds = await recentBlindspotIds(date);
  const { top } = pickBlindspots(ranked, recentIds);
  if (top) used.add(top.clusterId);

  // 2: the Resumo do dia clusters, cached lines only
  const heads = (await briefingHeads()).filter((h) => !used.has(h.id)).slice(0, 5);
  heads.forEach((h) => used.add(h.id));
  const lines = await briefingLinesFor(heads.map((h) => h.id));

  // 3: least covered in the weekday's category, falling through the rotation
  let bottom: { category: string; clusterId: number } | null = null;
  for (const category of categoryOrder(date)) {
    const id = await leastCoveredInCategory(category, used);
    if (id !== null) { bottom = { category, clusterId: id }; used.add(id); break; }
  }

  // 4: second blindspot — resolved LAST, against the exclusions top/middle/
  // bottom already claimed plus the 7-day no-repeat set (spec §1: top →
  // middle → bottom → second, cumulative exclusions).
  const second = top ? pickSecondBlindspot(ranked, top, new Set([...used, ...recentIds])) : null;
  if (second) used.add(second.clusterId);

  const ids = [top?.clusterId, second?.clusterId, ...heads.map((h) => h.id), bottom?.clusterId].filter((x): x is number => x != null);
  const faces = await facesFor(ids);
  const item = (id: number, extra: Partial<IssueItem> = {}): IssueItem | null => {
    const f = faces.get(id);
    if (!f) return null;
    return { clusterId: id, headline: f.headline, outlet: f.outlet, sides: f.sides, url: issueUrl(base, id, date), ...extra };
  };
  const bs = (b: Blindspot | null) => (b ? item(b.clusterId, { weakSide: b.weakSide, weakShare: b.weakShare }) : null);

  return {
    version: 1,
    date,
    top: bs(top),
    middle: heads
      .map((h) => {
        const line = lines.get(h.id);
        return item(h.id, line ? { line } : {});
      })
      .filter((x): x is IssueItem => x !== null),
    bottom: bottom ? (() => { const it = item(bottom.clusterId); return it ? { category: bottom.category, item: it } : null; })() : null,
    second: bs(second),
    composedAt: new Date().toISOString(),
  };
}

/* ---------- issues ---------- */

export async function getIssue(date: string): Promise<IssueRow | null> {
  const [row] = await db.select().from(tables.newsletterIssues).where(eq(tables.newsletterIssues.date, date)).limit(1);
  return row ?? null;
}

export async function insertIssue(
  date: string,
  issue: Issue,
  html: string,
  status: "composed" | "skipped" | "preview",
): Promise<boolean> {
  const r = await db
    .insert(tables.newsletterIssues)
    .values({ date, status, payload: issue as unknown as Record<string, unknown>, html })
    .onConflictDoNothing()
    .returning({ date: tables.newsletterIssues.date });
  return r.length === 1;
}

/**
 * The day's send lock, in ONE statement — the only way the worker may write
 * the issue row:
 *
 *   insert into newsletter_issues (date, status, payload, html) values (...)
 *   on conflict (date) do update
 *      set status = <status>, payload = ..., html = ..., composed_at = now()
 *    where newsletter_issues.status = 'preview'
 *   returning date
 *
 * True iff a row came back, i.e. iff THIS call created the row or took over an
 * admin `preview` row. Anything else (composed/sent/skipped/failed) is a day
 * already claimed and yields false.
 *
 * Two workers racing on a preview row cannot both win: `on conflict do update`
 * locks the conflicting row before it evaluates the `where`, so the loser
 * re-reads the row AFTER the winner's update, sees `status = 'composed'`,
 * updates nothing and returns no row. That is why the claim must stay a single
 * statement — a select-then-update would let both through.
 */
export async function claimIssueForSend(
  date: string,
  issue: Issue,
  html: string,
  status: "composed" | "skipped" = "composed",
): Promise<boolean> {
  const payload = issue as unknown as Record<string, unknown>;
  const r = await db
    .insert(tables.newsletterIssues)
    .values({ date, status, payload, html })
    .onConflictDoUpdate({
      target: tables.newsletterIssues.date,
      set: { status, payload, html, composedAt: sql`now()` },
      setWhere: sql`${tables.newsletterIssues.status} = 'preview'`,
    })
    .returning({ date: tables.newsletterIssues.date });
  return r.length === 1;
}

export async function markIssueSent(date: string, recipients: number, providerRef: string): Promise<void> {
  await db.update(tables.newsletterIssues).set({ status: "sent", sentAt: new Date(), recipients, providerRef, error: null }).where(eq(tables.newsletterIssues.date, date));
}

/**
 * `providerRef`, when given, is the comma-joined ids a partial send already
 * landed (PartialSendError.sentIds) — recorded so a failed send is never
 * silently double-billed, with `recipients` set to match (fix round 1).
 */
export async function markIssueFailed(date: string, error: string, providerRef?: string): Promise<void> {
  const sent = providerRef !== undefined
    ? { providerRef, recipients: providerRef ? providerRef.split(",").filter(Boolean).length : 0 }
    : {};
  await db.update(tables.newsletterIssues).set({ status: "failed", error: error.slice(0, 2000), ...sent }).where(eq(tables.newsletterIssues.date, date));
}

/** Zero confirmed subscribers: the issue stands (day's lock holds) but nothing sent. */
export async function markIssueSkipped(date: string): Promise<void> {
  await db.update(tables.newsletterIssues).set({ status: "skipped", recipients: 0 }).where(eq(tables.newsletterIssues.date, date));
}

export async function listIssues(limit: number): Promise<IssueRow[]> {
  return db.select().from(tables.newsletterIssues).orderBy(desc(tables.newsletterIssues.date)).limit(limit);
}

/* ---------- subscribers ---------- */

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 6 || e.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return null;
  return e;
}

/**
 * One insert with `on conflict do update ... where status <> 'confirmed'` so
 * a pending/unsubscribed row is reset and a confirmed row is left untouched
 * — no select-then-insert race on the email unique index. The row is read
 * back afterward because the effective token/status depend on which branch
 * fired: a confirmed row keeps its own token and status.
 *
 * Per-email cooldown (fix round 2): typing the same address repeatedly must
 * not mail its owner once per attempt — the per-IP limiter does not help when
 * the attacker rotates IPs at one victim. The upsert therefore refuses to
 * touch a `pending` row whose `created_at` is under 10 minutes old, and sets
 * `created_at = now()` whenever it DOES regenerate the token, so that column
 * doubles as "last confirmation sent" without a schema change. `throttled`
 * is true exactly when the caller must skip the email; the form's answer is
 * the same neutral message either way.
 */
const CONFIRM_COOLDOWN = "10 minutes";

export async function upsertPendingSubscriber(
  email: string,
  source: string,
): Promise<{ token: string; alreadyConfirmed: boolean; throttled: boolean }> {
  const token = randomBytes(32).toString("hex");
  const r = await db
    .insert(tables.newsletterSubscribers)
    .values({ email, token, source, status: "pending" })
    .onConflictDoUpdate({
      target: tables.newsletterSubscribers.email,
      set: { token, status: "pending", source, createdAt: sql`now()` },
      setWhere: sql`${tables.newsletterSubscribers.status} <> 'confirmed'
        and (${tables.newsletterSubscribers.status} <> 'pending'
             or ${tables.newsletterSubscribers.createdAt} < now() - interval '${sql.raw(CONFIRM_COOLDOWN)}')`,
    })
    .returning({ token: tables.newsletterSubscribers.token });
  // A returned row means this call inserted or regenerated: mail it.
  if (r.length === 1) return { token: r[0].token, alreadyConfirmed: false, throttled: false };
  // Nothing returned: `setWhere` refused. Either the row is confirmed, or it
  // is pending and inside the cooldown.
  const [row] = await db.select().from(tables.newsletterSubscribers).where(eq(tables.newsletterSubscribers.email, email)).limit(1);
  if (!row) throw new Error("upsertPendingSubscriber: row missing immediately after upsert");
  return { token: row.token, alreadyConfirmed: row.status === "confirmed", throttled: row.status !== "confirmed" };
}

export async function confirmSubscriber(token: string): Promise<boolean> {
  const r = await db
    .update(tables.newsletterSubscribers)
    .set({ status: "confirmed", confirmedAt: new Date(), unsubscribedAt: null })
    .where(and(eq(tables.newsletterSubscribers.token, token), inArray(tables.newsletterSubscribers.status, ["pending", "confirmed"])))
    .returning({ id: tables.newsletterSubscribers.id });
  return r.length === 1;
}

export async function unsubscribeByToken(token: string): Promise<boolean> {
  const r = await db
    .update(tables.newsletterSubscribers)
    .set({ status: "unsubscribed", unsubscribedAt: new Date() })
    .where(eq(tables.newsletterSubscribers.token, token))
    .returning({ id: tables.newsletterSubscribers.id });
  return r.length === 1;
}

export async function confirmedSubscribers(): Promise<Array<{ email: string; token: string }>> {
  return db
    .select({ email: tables.newsletterSubscribers.email, token: tables.newsletterSubscribers.token })
    .from(tables.newsletterSubscribers)
    .where(eq(tables.newsletterSubscribers.status, "confirmed"))
    .orderBy(tables.newsletterSubscribers.id);
}
