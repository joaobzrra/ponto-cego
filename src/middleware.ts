import { NextResponse, type NextRequest } from "next/server";
import { canonicalHost, publicIndexingEnabled } from "@/lib/seo";

/**
 * Two jobs:
 *
 * 1. Invite-link handler for the calibration preview (spec §10 private
 *    period): /?convite=CODE sets the preview cookie and redirects to a clean
 *    URL. Page renders can't set cookies in Next — this is the one place that
 *    can.
 *
 * 2. Per-host robots: one deployment serves both pontocego.app and
 *    preview.pontocego.app (same server behind cloudflared), so any host
 *    other than the canonical one gets X-Robots-Tag: noindex — the preview
 *    hostname stays out of search engines FOREVER, even after the
 *    PREVIEW_ACCESS_CODE launch flip opens the meta-robots. Canonical links
 *    (src/lib/seo.ts pageMeta) already point every page at the canonical
 *    host.
 */
export function middleware(request: NextRequest) {
  const code = process.env.PREVIEW_ACCESS_CODE ?? "";
  const candidate = request.nextUrl.searchParams.get("convite");

  let response: NextResponse;
  if (code && candidate) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("convite");
    response = NextResponse.redirect(url);
    if (candidate === code) {
      response.cookies.set("pc_preview", code, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 365 * 24 * 60 * 60,
        path: "/",
      });
    }
  } else {
    response = NextResponse.next();
  }

  const host = request.headers.get("host")?.toLowerCase() ?? "";
  // localhost/dev ports differ from the canonical host too — noindex there is
  // harmless (nothing indexes localhost) and keeps the rule unconditional.
  if (!publicIndexingEnabled() || host !== canonicalHost()) {
    response.headers.set("X-Robots-Tag", "noindex, follow, noarchive");
  }
  return response;
}

export const config = {
  // Everything except Next internals and static assets; /admin and /api need
  // no robots header (robots.txt disallows them) and skipping them keeps the
  // invite/robots logic off hot API paths.
  matcher: ["/((?!_next/|api/|admin|favicon\\.ico|icons/|brand/).*)"],
};
