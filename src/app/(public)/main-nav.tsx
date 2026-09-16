"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Início" },
  { href: "/noticias", label: "Últimas Notícias" },
  { href: "/veiculos", label: "Veículos" },
  { href: "/sobre", label: "Sobre" },
];

/*
 * Main menu. Always fully visible (the faded-idle and dock-hover experiments
 * were both cut 2026-07-18/19 — anything that dims or shrinks siblings read
 * as broken, not subtle); the CSS hover is just the hovered item growing
 * slightly. Client component only for usePathname() → aria-current.
 */
export function MainNav() {
  const pathname = usePathname();

  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="pc-menu" aria-label="Navegação principal">
      {ITEMS.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={isCurrent(it.href) ? "page" : undefined}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
