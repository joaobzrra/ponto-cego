"use client";

import { recordReading } from "@/lib/perfil-local";

/**
 * The redirect-first continue link (spec §3.3), with two hooks on click:
 * the local-profile counter (localStorage only, opt-in — lib/perfil-local.ts)
 * and the first-party clickout beacon (pseudonymous, /api/e). keepalive lets
 * the request survive the new tab taking focus.
 */
export function ContinueLink({
  articleId,
  href,
  outletName,
  band,
}: {
  articleId: number;
  href: string;
  outletName: string;
  band: string | null;
}) {
  // Ingestion already refuses non-http(s) links; guard again at the render so
  // a bad row can never become a javascript: href (defence in depth).
  const safeHref = /^https?:\/\//i.test(href) ? href : "#";
  return (
    <a
      className="pc-continue"
      href={safeHref}
      target="_blank"
      rel="noopener"
      onClick={() => {
        recordReading(articleId, band);
        fetch("/api/e", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "clickout", path: `/a/${articleId}`, articleId }),
          keepalive: true,
        }).catch(() => {});
      }}
    >
      Continuar para {outletName} →
    </a>
  );
}
