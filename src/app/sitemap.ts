import type { MetadataRoute } from "next";
import { sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { publicIndexingEnabled, siteUrl } from "@/lib/seo";

// Regenerated per request (force-dynamic like the pages it lists) so topic
// entries track the news cycle without a rebuild.
export const dynamic = "force-dynamic";

/**
 * Sitemap policy (user decision 2026-07-14): listing/topic/static pages only.
 * Article gate cards (/a/[id]) are permanently noindex — thin content — and
 * /buscar is a search-results page; neither belongs here.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!publicIndexingEnabled()) return [];

  const base = siteUrl();
  const now = new Date();

  // During the calibration preview only the ungated static pages exist for
  // crawlers (everything is noindex anyway; this keeps the sitemap honest).
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${base}/sobre`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/rubrica`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/privacidade`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
  // Top topics of the last 30 days (same tally idiom as trendingTopics on the
  // home page), bounded to keep the sitemap small and meaningful.
  const topics = await db.execute(sql`
    select lower(kw) as kw, count(*)::int as n
    from ${tables.articles}, jsonb_array_elements_text(${tables.articles.keywords}) as kw
    where ${tables.articles.fetchedAt} > now() - interval '30 days'
      and ${tables.articles.status} = 'published'
      and length(kw) > 2
    group by lower(kw)
    order by n desc
    limit 50
  `);

  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/noticias`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/veiculos`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    ...staticPages,
    ...(topics.rows as Array<{ kw: string }>).map(({ kw }) => ({
      url: `${base}/t/${encodeURIComponent(kw)}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ];
}
