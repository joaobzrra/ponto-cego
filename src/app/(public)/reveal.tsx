"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Scroll reveals (polish pass 2026-07-18): card-level elements BELOW the
 * current viewport fade up as they scroll in, staggered per batch. Elements
 * already visible at scan time are never touched — no flash of hiding
 * content the reader is looking at. Without JS nothing is tagged, so the
 * page renders normally; reduced-motion gets an explicit always-visible
 * override in globals.css.
 */
const TARGETS = [
  ".pc-alta-card",
  ".pc-sides-col",
  ".pc-side-section",
  ".pc-row",
  ".pc-card",
  ".pc-src-card",
].join(", ");

const STAGGER_MS = 120;

export function RevealObserver() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const below = Array.from(document.querySelectorAll<HTMLElement>(TARGETS)).filter(
      (el) =>
        !el.classList.contains("pc-reveal") &&
        el.getBoundingClientRect().top > window.innerHeight,
    );
    if (below.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        let batchIndex = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.style.transitionDelay = `${batchIndex * STAGGER_MS}ms`;
          el.classList.add("is-in");
          io.unobserve(el);
          batchIndex += 1;
        }
      },
      { rootMargin: "0px 0px -5% 0px" },
    );

    for (const el of below) {
      el.classList.add("pc-reveal");
      io.observe(el);
    }
    return () => io.disconnect();
  }, [pathname]);

  return null;
}
