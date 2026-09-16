import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import { db, tables } from "@/db";
import { safeJoin, SNAPSHOTS_DIR, THUMBS_DIR } from "@/lib/paths";

const SNAPSHOT_RETENTION_DAYS = 7; // spec §3.2
const LOGIN_ATTEMPT_RETENTION_HOURS = 24; // spec §7: no IP retention beyond rate-limit windows
const EVENT_RETENTION_DAYS = 90; // /privacidade promise: raw events age out
const BOT_EVENT_RETENTION_DAYS = 7; // crawler noise, kept briefly for visibility
const ANALYTICS_TZ = "America/Fortaleza";
/**
 * Thumbnails outlive their usefulness fast — they only ever render in the
 * front-page and listing cards, which never reach back this far. Until
 * 2026-07-26 they had NO retention at all and were the only uncapped store in
 * the project: 45,914 files / 390 MB after three weeks, ~28 MB/day, ~10 GB/yr.
 */
const THUMB_RETENTION_DAYS = 7;
/**
 * Clearing thumbnail_path is an UPDATE on `articles`, whose rows carry a
 * 1024-dim vector — a full-table sweep rewrites ~500 MB of heap and has taken
 * the site down before. So: small batches, and a per-run cap that lets the
 * first (large) backlog drain across a few nightly runs instead of one spike.
 */
const THUMB_PRUNE_BATCH = 500;
const THUMB_PRUNE_MAX_PER_RUN = 5_000;
/** health.ts never looks past its 7d window, so 30d is pure headroom. */
const FETCH_RUN_RETENTION_DAYS = 30;

/**
 * Rolls every fully-finished day of events (up to yesterday) that isn't in
 * events_daily yet into the permanent aggregates, one row per (type, dim,
 * key). Idempotent: reruns upsert the same day. Runs BEFORE the raw prune so
 * no day is ever lost between the two steps.
 */
async function rollupEventsDaily(): Promise<void> {
  await db.execute(sql`
    insert into events_daily (day, type, dim, key, count, sessions)
    select day, type, dim, key, count, sessions from (
      select (e.created_at at time zone ${ANALYTICS_TZ})::date as day, e.type,
             d.dim,
             case d.dim
               when 'path' then e.path
               when 'outlet' then o.slug
               when 'query' then e.query
               when 'referrer' then e.referrer_host
               when 'utm' then e.utm_source || coalesce('/' || e.utm_campaign, '')
               when 'band' then e.band
             end as key,
             count(*)::int as count,
             count(distinct e.session_id)::int as sessions
      from events e
        left join outlets o on o.id = e.outlet_id
        cross join (values ('path'), ('outlet'), ('query'), ('referrer'), ('utm'), ('band')) as d(dim)
      where not e.is_bot
        and (e.created_at at time zone ${ANALYTICS_TZ})::date
              < (now() at time zone ${ANALYTICS_TZ})::date
      group by 1, 2, 3, 4
    ) agg
    where key is not null
    on conflict (day, type, dim, key)
      do update set count = excluded.count, sessions = excluded.sessions
  `);
}

/**
 * Deletes thumbnail files past the window and clears the pointer on the article
 * so the UI never renders a broken image. Batched + capped — see the constants.
 */
async function pruneThumbnails(): Promise<number> {
  const cutoff = new Date(Date.now() - THUMB_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let pruned = 0;

  while (pruned < THUMB_PRUNE_MAX_PER_RUN) {
    const batch = await db
      .select({ id: tables.articles.id, thumbnailPath: tables.articles.thumbnailPath })
      .from(tables.articles)
      .where(
        and(isNotNull(tables.articles.thumbnailPath), lt(tables.articles.fetchedAt, cutoff)),
      )
      .limit(THUMB_PRUNE_BATCH);
    if (batch.length === 0) break;

    for (const article of batch) {
      if (!article.thumbnailPath) continue;
      try {
        await unlink(safeJoin(THUMBS_DIR, article.thumbnailPath));
      } catch {
        // already gone — clearing the column below is still correct
      }
    }
    await db
      .update(tables.articles)
      .set({ thumbnailPath: null })
      .where(
        inArray(
          tables.articles.id,
          batch.map((a) => a.id),
        ),
      );
    pruned += batch.length;
  }

  return pruned;
}

/** Daily cleanup: expired snapshots (files + rows), thumbnails, sessions, login attempts. */
export async function runRetention(): Promise<{
  snapshotsDeleted: number;
  thumbsDeleted: number;
  fetchRunsDeleted: number;
}> {
  const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const expired = await db
    .select({ id: tables.rawSnapshots.id, filePath: tables.rawSnapshots.filePath })
    .from(tables.rawSnapshots)
    .where(lt(tables.rawSnapshots.fetchedAt, cutoff));

  for (const snap of expired) {
    try {
      await unlink(safeJoin(SNAPSHOTS_DIR, snap.filePath));
    } catch {
      // file already gone — row cleanup below still applies
    }
  }
  if (expired.length > 0) {
    await db.delete(tables.rawSnapshots).where(lt(tables.rawSnapshots.fetchedAt, cutoff));
  }

  await db.delete(tables.adminSessions).where(lt(tables.adminSessions.expiresAt, new Date()));
  await db
    .delete(tables.loginAttempts)
    .where(
      lt(
        tables.loginAttempts.attemptedAt,
        new Date(Date.now() - LOGIN_ATTEMPT_RETENTION_HOURS * 60 * 60 * 1000),
      ),
    );

  // Analytics: aggregate finished days into events_daily, THEN age out raw
  // rows (90d, /privacidade) and crawler noise (7d).
  await rollupEventsDaily();
  await db
    .delete(tables.events)
    .where(
      lt(tables.events.createdAt, new Date(Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000)),
    );
  await db
    .delete(tables.events)
    .where(
      and(
        eq(tables.events.isBot, true),
        lt(
          tables.events.createdAt,
          new Date(Date.now() - BOT_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
        ),
      ),
    );

  const thumbsDeleted = await pruneThumbnails();

  const fetchRunsDeleted = await db
    .delete(tables.fetchRuns)
    .where(
      lt(
        tables.fetchRuns.startedAt,
        new Date(Date.now() - FETCH_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000),
      ),
    )
    .returning({ id: tables.fetchRuns.id });

  return { snapshotsDeleted: expired.length, thumbsDeleted, fetchRunsDeleted: fetchRunsDeleted.length };
}
