import * as cheerio from "cheerio";
import { and, eq, inArray } from "drizzle-orm";
import Parser from "rss-parser";
import { db, tables } from "@/db";
import { pickExcerpt } from "@/lib/excerpt";
import { fetchWithTimeout, isHttpUrl, readBodyCapped } from "@/lib/http";
import { robotsAllowed } from "@/lib/robots";
import { saveSnapshot } from "@/lib/snapshots";
import { createThumbnail } from "@/lib/thumbnails";

// Streaming caps (src/lib/http.ts readBodyCapped): a feed or article page
// larger than this is refused instead of buffered whole into worker memory.
const MAX_FEED_BYTES = 10 * 1024 * 1024;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;

type Outlet = typeof tables.outlets.$inferSelect;
type Feed = typeof tables.feeds.$inferSelect;

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
    ],
  },
});

type FeedItem = Parser.Item & {
  mediaContent?: Array<{ $?: { url?: string; medium?: string; type?: string } }>;
  mediaThumbnail?: Array<{ $?: { url?: string } }>;
};

function imageUrlFromItem(item: FeedItem): string | null {
  if (item.enclosure?.url && (item.enclosure.type ?? "").startsWith("image")) {
    return item.enclosure.url;
  }
  for (const mc of item.mediaContent ?? []) {
    const url = mc.$?.url;
    const isImage =
      (mc.$?.medium ?? "") === "image" || (mc.$?.type ?? "").startsWith("image") || !mc.$?.type;
    if (url && isImage) return url;
  }
  const thumb = item.mediaThumbnail?.[0]?.$?.url;
  return thumb ?? null;
}

/**
 * Fallback when the feed carries no image: fetch the article page for its
 * og:image. The HTML is used transiently and never stored — nothing beyond the
 * capped excerpt is ever kept as article content.
 *
 * This used to also write an `article_html` snapshot "for debugging". Nothing
 * ever read one: they carry a null feed_id, so even the admin health panel
 * (which selects snapshots by feed_id) could not show them. By 2026-07-26 they
 * had reached 2,665 MB — 42% of all storage in the project — write-only. If a
 * parse ever needs the page, re-fetch it; the snapshot was at most 7 days old
 * anyway.
 */
async function imageUrlFromArticlePage(
  outlet: Outlet,
  articleUrl: string,
): Promise<string | null> {
  try {
    if (!(await robotsAllowed(articleUrl))) return null;
    const res = await fetchWithTimeout(articleUrl, {
      timeoutMs: 15_000,
      headers: outlet.fetchUserAgent ? { "user-agent": outlet.fetchUserAgent } : undefined,
    });
    if (!res.ok) return null;
    const html = (await readBodyCapped(res, MAX_PAGE_BYTES)).toString("utf8");
    const $ = cheerio.load(html);
    return (
      $('meta[property="og:image"]').attr("content") ??
      $('meta[name="twitter:image"]').attr("content") ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * Real-world feed quirks seen in the soak. UOL serves `<rss>` without a
 * version attribute, which rss-parser rejects as "not RSS 1 or 2" — the raw
 * snapshot on disk stays untouched, only the parse input is patched.
 */
function normalizeFeedXml(xml: string): string {
  return xml.replace(/<rss(?![^>]*\bversion=)/i, '<rss version="2.0"');
}

/**
 * Decode a feed body honoring its declared charset. `res.text()` always
 * decodes UTF-8, but the UOL-family feeds (Folha, UOL) serve ISO-8859-1 —
 * every accented character ingested as U+FFFD (soak find, 2026-07-10).
 * Precedence: Content-Type charset → XML declaration → UTF-8.
 */
function decodeFeedBody(buf: ArrayBuffer | Uint8Array, contentType: string | null): string {
  const headerCharset = contentType?.match(/charset=["']?([\w-]+)/i)?.[1];
  // The XML declaration is ASCII-compatible in any charset we care about;
  // sniff it via latin1, which never throws on arbitrary bytes.
  const head = new TextDecoder("latin1").decode(buf.slice(0, 256));
  const declCharset = head.match(/<\?xml[^>]*encoding=["']([\w.-]+)["']/i)?.[1];
  const charset = (headerCharset ?? declCharset ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    // Unknown charset label — best-effort UTF-8 beats dropping the feed.
    return new TextDecoder("utf-8").decode(buf);
  }
}

export type PollResult = {
  outlet: string;
  feed: string;
  scope: string;
  fetchOk: boolean;
  parseOk: boolean;
  notModified: boolean;
  articlesSeen: number;
  /** Rows inserted + rows rescoped geral→politica (new to this feed's scope). */
  articlesNew: number;
  error?: string;
};

/** Polls every enabled feed of one outlet; one fetch_runs row per feed. */
export async function pollOutlet(outlet: Outlet): Promise<PollResult[]> {
  const outletFeeds = await db
    .select()
    .from(tables.feeds)
    .where(and(eq(tables.feeds.outletId, outlet.id), eq(tables.feeds.enabled, true)))
    .orderBy(tables.feeds.id);

  const results: PollResult[] = [];
  for (const feed of outletFeeds) {
    results.push(await pollFeed(outlet, feed));
  }
  return results;
}

async function pollFeed(outlet: Outlet, feed: Feed): Promise<PollResult> {
  const startedAt = new Date();
  let httpStatus: number | null = null;
  let fetchOk = false;
  let parseOk = false;
  let notModified = false;
  let articlesSeen = 0;
  let articlesNew = 0;
  let snapshotId: number | null = null;
  let errorText: string | null = null;

  try {
    const headers: Record<string, string> = {
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
    };
    if (outlet.fetchUserAgent) headers["user-agent"] = outlet.fetchUserAgent;
    if (feed.httpEtag) headers["if-none-match"] = feed.httpEtag;
    if (feed.httpLastModified) headers["if-modified-since"] = feed.httpLastModified;

    const res = await fetchWithTimeout(feed.url, { headers });
    httpStatus = res.status;

    if (res.status === 304) {
      fetchOk = true;
      parseOk = true;
      notModified = true;
    } else if (!res.ok) {
      errorText = `HTTP ${res.status} on ${feed.url}`;
    } else {
      fetchOk = true;

      const xml = decodeFeedBody(
        await readBodyCapped(res, MAX_FEED_BYTES),
        res.headers.get("content-type"),
      );
      snapshotId = await saveSnapshot(outlet.id, outlet.slug, "feed_xml", xml, feed.id);

      const parsed = await parser.parseString(normalizeFeedXml(xml));
      parseOk = true;
      const items = (parsed.items ?? []) as FeedItem[];
      articlesSeen = items.length;
      articlesNew = await ingestItems(outlet, feed, items);

      // Persist conditional-GET validators only after a successful parse:
      // caching an ETag from a fetch whose parse failed makes every later poll
      // 304 with parse_ok=true — a permanently silent feed (soak find, 2026-07-07).
      const etag = res.headers.get("etag");
      const lastModified = res.headers.get("last-modified");
      if (etag || lastModified) {
        await db
          .update(tables.feeds)
          .set({ httpEtag: etag, httpLastModified: lastModified })
          .where(eq(tables.feeds.id, feed.id));
      }
    }
  } catch (err) {
    errorText = err instanceof Error ? err.message : String(err);
  }

  await db.insert(tables.fetchRuns).values({
    outletId: outlet.id,
    feedId: feed.id,
    startedAt,
    finishedAt: new Date(),
    httpStatus,
    notModified,
    fetchOk,
    parseOk,
    articlesSeen,
    articlesNew,
    errorText,
    snapshotId,
  });

  return {
    outlet: outlet.slug,
    feed: feed.url,
    scope: feed.scope,
    fetchOk,
    parseOk,
    notModified,
    articlesSeen,
    articlesNew,
    error: errorText ?? undefined,
  };
}

/**
 * Outlet RSS quirks that defeat the (outlet_id, guid) uniqueness — normalize
 * BEFORE the known/fresh check (both caught 2026-07-14 in the user's admin
 * cluster spot-check):
 * - Folha wraps link AND guid in a PER-FEED redirector
 *   (redir.folha.com.br/redir/online/<section>/rss091/*<real-url>), so the
 *   same story ingests once per feed it appears in. Unwrap to the real URL.
 * - BBC appends an incrementing revision fragment to the guid
 *   (…/articles/xyz#0, #2, #6) on each newsroom update, re-ingesting the same
 *   story per revision. Strip the fragment — BBC guids only; fragments are
 *   opaque identifiers elsewhere and must not be touched generically.
 */
export function normalizeIdentity(guid: string, link: string): { guid: string; link: string } {
  const unwrapFolha = (u: string) => {
    const m = u.match(/^https?:\/\/redir\.folha\.com\.br\/redir\/[^*]*\*(https?:\/\/.+)$/);
    return m ? m[1] : u;
  };
  guid = unwrapFolha(guid);
  link = unwrapFolha(link);
  if (/^https?:\/\/www\.bbc\.com\//.test(guid)) guid = guid.replace(/#\d+$/, "");
  return { guid, link };
}

async function ingestItems(outlet: Outlet, feed: Feed, items: FeedItem[]): Promise<number> {
  const candidates = items
    .map((item) => {
      const rawLink = item.link?.trim();
      // <guid> with XML attributes parses as an object, not a string — fall
      // back to the link so one malformed item can't fail the whole cycle.
      const rawGuid = (typeof item.guid === "string" ? item.guid : rawLink)?.trim();
      if (!rawGuid || !rawLink) return null;
      const { guid, link } = normalizeIdentity(rawGuid, rawLink);
      // canonical_url is rendered as a clickable href; refuse anything that is
      // not an absolute http(s) URL (javascript:, data:, relative paths).
      if (!isHttpUrl(link)) return null;
      return { item, guid, link };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
  if (candidates.length === 0) return 0;

  const existing = await db
    .select({ guid: tables.articles.guid })
    .from(tables.articles)
    .where(
      and(
        eq(tables.articles.outletId, outlet.id),
        inArray(
          tables.articles.guid,
          candidates.map((c) => c.guid),
        ),
      ),
    );
  const known = new Set(existing.map((e) => e.guid));
  const fresh = candidates.filter((c) => !known.has(c.guid));

  // Addendum 01 §A1 rule 3: an article seen in both feeds of the same outlet
  // stays one row; politica scope wins over geral. Rescopes count toward this
  // feed's articlesNew: the geral feed polls first (lower id) and wins the
  // insert race for cross-posted stories, so without this credit a política
  // feed reads ~0 new per cycle and health.ts flags it Degraded while its
  // content is in fact flowing (soak find, 2026-07-08 — recurring G1 alerts).
  let rescoped = 0;
  if (feed.scope === "politica" && known.size > 0) {
    const updated = await db
      .update(tables.articles)
      .set({ feedScope: "politica" })
      .where(
        and(
          eq(tables.articles.outletId, outlet.id),
          inArray(tables.articles.guid, [...known]),
          eq(tables.articles.feedScope, "geral"),
        ),
      )
      .returning({ id: tables.articles.id });
    rescoped = updated.length;
  }

  let inserted = 0;
  for (const { item, guid, link } of fresh) {
    const title = (item.title ?? "").trim();
    if (!title) continue;

    // Thumbnail: feed-provided image first, article page og:image as fallback.
    let imageUrl = imageUrlFromItem(item);
    if (!imageUrl) imageUrl = await imageUrlFromArticlePage(outlet, link);
    const thumbnailPath = imageUrl
      ? await createThumbnail(imageUrl, outlet, guid)
      : null;

    const publishedAt = item.isoDate
      ? new Date(item.isoDate)
      : item.pubDate
        ? new Date(item.pubDate)
        : null;

    await db
      .insert(tables.articles)
      .values({
        outletId: outlet.id,
        guid,
        canonicalUrl: link,
        title,
        excerpt: pickExcerpt(item),
        publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
        thumbnailPath,
        feedScope: feed.scope,
      })
      .onConflictDoNothing();
    inserted++;
  }
  return inserted + rescoped;
}
