import type { Metadata } from "next";

/**
 * SEO single source of truth.
 *
 * The whole site rides ONE launch switch (spec §10): while PREVIEW_ACCESS_CODE
 * is set we are in the private calibration preview and every page is noindex;
 * unsetting it (the launch flip) makes launchRobots() open the index — no code
 * change, no deploy beyond the env bounce. Pages that must NEVER be indexed
 * (article gate cards, /buscar results) pass noindex: true and win regardless
 * of launch state.
 *
 * Canonical URLs always point at siteUrl() (pontocego.app), whatever hostname
 * served the request — that is how preview.pontocego.app self-canonicalizes to
 * production. The per-host X-Robots-Tag lives in src/middleware.ts.
 */

export function siteUrl(): string {
  return process.env.SITE_URL ?? "https://pontocego.app";
}

export function canonicalHost(): string {
  return new URL(siteUrl()).host;
}

/** Public access and search indexing are independent; indexing is opt-in. */
export function publicIndexingEnabled(): boolean {
  return process.env.PUBLIC_INDEXING_ENABLED === "true";
}

export function launchRobots(): NonNullable<Metadata["robots"]> {
  return publicIndexingEnabled()
    ? { index: true, follow: true }
    : { index: false, follow: true, nocache: true };
}

export function pageMeta({
  path,
  title,
  description,
  noindex = false,
  ogImage,
}: {
  /** Absolute path starting with "/" — becomes the canonical URL. */
  path: string;
  title: string;
  description: string;
  /** Never index this page, even after launch (gate cards, /buscar). */
  noindex?: boolean;
  /** Override the default OG image (relative to metadataBase). */
  ogImage?: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: siteUrl() + path },
    robots: noindex ? { index: false, follow: true } : launchRobots(),
    openGraph: {
      title,
      description,
      url: siteUrl() + path,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}
