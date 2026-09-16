import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { CalibrationBadge } from "@/components/calibration-badge";
import { HeaderSearch } from "@/components/header-search";

/*
 * Header v2 (Final-Wireframe): logo dead-center; Newsletter/Patrono at left
 * (solid/ghost button pair — hovers invert each other); keyword search at
 * right. The search is a plain GET form to /buscar — no JS; the icon's click
 * "pop" is pure CSS (:active keyframe on the svg).
 */
export function SiteHeader() {
  return (
    <header className="pc-hd">
      <div className="pc-hd-left">
        <CalibrationBadge />
        <Link href="/newsletter" className="pc-btn pc-btn--solid">
          Newsletter
        </Link>
        <Link href="/patrono" className="pc-btn pc-btn--ghost">
          Patrono
        </Link>
      </div>
      <Link href="/" className="pc-hd-logo">
        {/* Dark strokes on alpha — the CSS invert renders it light-on-dark. */}
        <img src="/brand/pontocego-logo.png" alt={BRAND.wordmark} className="pc-brand-logo" />
      </Link>
      <HeaderSearch />
    </header>
  );
}
