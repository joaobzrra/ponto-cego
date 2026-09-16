import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { cookies } from "next/headers";
import { AnalyticsBeacon } from "@/components/analytics-beacon";
import { BRAND } from "@/lib/brand";
import { launchRobots, siteUrl } from "@/lib/seo";
import "./globals.css";

/*
 * Type identity v3 (2026-07-18, designer decision — Final-Wireframe): ONE
 * family. Bricolage Grotesque carries everything, differentiated by weight
 * alone — ExtraLight 200 for data captions, Regular 400 for text/titles,
 * ExtraBold 800 for section labels. Variable font, so the whole 200–800
 * axis ships in a single self-hosted file. (v2's Instrument Sans retired;
 * the few italic timestamps now render as synthetic oblique.)
 */
const brandFont = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  variable: "--font-title",
  display: "swap",
});

// Robots flip automatically with the launch switch (PREVIEW_ACCESS_CODE unset
// = indexable) — see src/lib/seo.ts. Per-page canonical/OG comes from pageMeta.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: BRAND.name, template: `%s — ${BRAND.name}` },
  description: BRAND.tagline,
  robots: launchRobots(),
  openGraph: {
    siteName: BRAND.name,
    locale: "pt_BR",
    type: "website",
    title: BRAND.name,
    description: BRAND.tagline,
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND.name,
    description: BRAND.tagline,
  },
};

/*
 * Theme (2026-07-21): the preference lives in the first-party `pc-theme`
 * cookie and is rendered SERVER-side, so `<html>` already carries the right
 * attribute in the HTML — no flash, and nothing for hydration to reconcile.
 * (A localStorage + inline-script version was tried first: React strips
 * attributes added to <html> before hydration, so the theme silently
 * reverted on every load.) Dark is the default and needs no attribute.
 */
// The color-scheme META mirrors the CSS token above so the browser knows
// before the stylesheet arrives; "only light" also opts the light theme out
// of Android's Auto Dark Theme (see globals.css).
export async function generateViewport(): Promise<Viewport> {
  const light = (await cookies()).get("pc-theme")?.value === "light";
  return { colorScheme: light ? "only light" : "dark" };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("pc-theme")?.value === "light" ? "light" : undefined;
  return (
    <html lang="pt-BR" className={brandFont.variable} data-theme={theme}>
      <body>
        {children}
        <AnalyticsBeacon />
      </body>
    </html>
  );
}
