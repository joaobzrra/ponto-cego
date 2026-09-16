import type { MetadataRoute } from "next";
import { publicIndexingEnabled, siteUrl } from "@/lib/seo";

// Flips with the launch switch (PREVIEW_ACCESS_CODE) — evaluated per request.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const indexing = publicIndexingEnabled();
  return {
    // /a/ is deliberately NOT disallowed: crawlers must be able to fetch the
    // gate cards to see their noindex meta (they're excluded from the sitemap
    // instead). Disallowing would leave them indexable as URL-only entries.
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api"] },
    ...(indexing ? { sitemap: `${siteUrl()}/sitemap.xml` } : {}),
  };
}
