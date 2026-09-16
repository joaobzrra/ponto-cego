"use client";

import { useEffect, useState } from "react";

const COOKIE = "pc-theme";
const ONE_YEAR = 60 * 60 * 24 * 365;

/*
 * Light/dark switch. The preference is a first-party cookie so the root
 * layout can render `data-theme` server-side (see app/layout.tsx) — the DOM
 * is updated here too so the switch is instant, without waiting for a
 * navigation. Dark is the site default and carries no attribute.
 *
 * Public variant: a line-art half-disc in the same 34px bordered box as the
 * header magnifier (owner review 2026-09-03: the old text glyph rendered
 * 20x28 on phones and was easy to miss). Styles live in public.css
 * (.pc-hd-theme); the admin variant keeps its own button chrome.
 */
const HalfDisc = () => (
  <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden fill="none">
    <circle cx="10" cy="10" r="6.75" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 3.25a6.75 6.75 0 0 1 0 13.5z" fill="currentColor" />
  </svg>
);

export function ThemeToggle({ variant = "public" }: { variant?: "admin" | "public" }) {
  const [mounted, setMounted] = useState(false);
  const [isLight, setIsLight] = useState(false);

  // The server already applied the theme; read it back so the button's state
  // matches without a hydration mismatch.
  useEffect(() => {
    setIsLight(document.documentElement.dataset.theme === "light");
    setMounted(true);
  }, []);

  function toggle() {
    const next = !isLight;
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    document.cookie = `${COOKIE}=${next ? "light" : "dark"}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    setIsLight(next);
  }

  return (
    <button
      type="button"
      className={variant === "admin" ? "ghost" : "pc-hd-theme"}
      onClick={toggle}
      aria-pressed={mounted && isLight}
      aria-label="Alternar tema claro/escuro"
      title={mounted && isLight ? "Tema escuro" : "Tema claro"}
    >
      {variant === "admin" ? <span aria-hidden>◐</span> : <HalfDisc />}
    </button>
  );
}
