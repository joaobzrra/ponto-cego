import Link from "next/link";
import { BRAND } from "@/lib/brand";

/*
 * Footer v2 (Final-Wireframe): half-faded logo + trust links. The rubric
 * gets its own footer entry now that it lives at /rubrica instead of inside
 * Sobre. "sem anúncios" stays — one line of trust signal, kept by user
 * decision 2026-07-18.
 */
export function Footer() {
  return (
    <footer className="pc-footer">
      <img
        src="/brand/pontocego-logo.png"
        alt=""
        aria-hidden
        className="pc-footer-logo"
      />
      <div className="pc-footer-links">
        <Link href="/privacidade">privacidade</Link>
        <Link href="/rubrica">rubrica</Link>
        <a href={`mailto:${BRAND.contactEmail}`}>correções e contato</a>
        <span>sem anúncios, por decisão estrutural</span>
      </div>
    </footer>
  );
}
