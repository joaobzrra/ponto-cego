"use client";

import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";

/*
 * Header search. On the home page the strip (search-strip.tsx) owns the
 * text field, so the header keeps only the 34px magnifier that jumps to it —
 * one search box per page (spec §1). Everywhere else: the live GET form.
 */
const Glass = () => (
  <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden fill="none">
    <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.5" />
    <line x1="13" y1="13" x2="17.5" y2="17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export function HeaderSearch() {
  const home = usePathname() === "/";
  if (home) {
    return (
      <div className="pc-hd-search pc-hd-search--icon">
        <a href="#busca-home" aria-label="Buscar" className="pc-hd-glass">
          <Glass />
        </a>
        <ThemeToggle variant="public" />
      </div>
    );
  }
  return (
    <form className="pc-hd-search" action="/buscar" method="get" role="search">
      <button type="submit" aria-label="Buscar">
        <Glass />
      </button>
      <input type="search" name="q" placeholder="Buscar palavras-chave" aria-label="Buscar palavras-chave" />
      <ThemeToggle variant="public" />
    </form>
  );
}
