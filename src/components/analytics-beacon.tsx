"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

/**
 * First-party pageview beacon (see src/app/api/e/route.ts for the privacy
 * contract). Client-side because soft navigations — above all the
 * intercepted-route article modal — never re-run server components, so only
 * the router knows a "page" was seen. fetch keepalive (not sendBeacon) so the
 * response's Set-Cookie can mint pc_sess on a first visit.
 */
function Beacon() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastSent = useRef<string | null>(null);
  const firstLoad = useRef(true);

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    if (lastSent.current === pathname) return;
    lastSent.current = pathname;

    const payload: Record<string, unknown> = { type: "pageview", path: pathname };
    if (firstLoad.current) {
      firstLoad.current = false;
      if (document.referrer) payload.ref = document.referrer;
      const utm = {
        source: searchParams.get("utm_source") ?? undefined,
        medium: searchParams.get("utm_medium") ?? undefined,
        campaign: searchParams.get("utm_campaign") ?? undefined,
      };
      if (utm.source || utm.medium || utm.campaign) payload.utm = utm;
    }

    fetch("/api/e", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Métrica é melhor-esforço: nunca interfere na navegação.
    });
    // searchParams deliberately not a dependency: utm only matters on the
    // first load, and re-sending on filter changes would double-count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}

export function AnalyticsBeacon() {
  // useSearchParams requires a Suspense boundary when mounted in the root
  // layout; the beacon renders nothing either way.
  return (
    <Suspense fallback={null}>
      <Beacon />
    </Suspense>
  );
}
