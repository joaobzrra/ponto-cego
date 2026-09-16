"use client";

import { useState, type ReactNode } from "react";

/**
 * Mobile filter-bubble-safe switcher (spec §2): the three ideological columns
 * become equal-weight tabs on narrow viewports. There is deliberately no fixed
 * default landing tab — the server passes a random initial index so no side
 * gets systematic first-position exposure. Desktop shows all three side by
 * side (the tabs are hidden by CSS).
 */
const COLUMNS = [
  { key: "esquerda", label: "Esquerda", accent: "var(--vies-esquerda)" },
  { key: "centro", label: "Centro", accent: "var(--vies-centro)" },
  { key: "direita", label: "Direita", accent: "var(--vies-direita)" },
] as const;

export function ColumnTabs({
  initialIndex,
  titles,
  children,
}: {
  initialIndex: number;
  /** Column headings; defaults to the front page's "Viés X". /topicos passes
   * coverage-dominance wording — same columns, different claim. */
  titles?: [string, string, string];
  children: [ReactNode, ReactNode, ReactNode];
}) {
  const [active, setActive] = useState(initialIndex);
  return (
    <div>
      <div className="pc-tabs" role="tablist" aria-label="Colunas por viés">
        {COLUMNS.map((c, i) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={active === i}
            data-active={active === i}
            style={{ ["--col-accent" as string]: c.accent }}
            onClick={() => setActive(i)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="pc-columns">
        {COLUMNS.map((c, i) => (
          <section
            key={c.key}
            className="pc-col"
            data-active={active === i}
            style={{ ["--col-accent" as string]: c.accent }}
          >
            <h2 className="pc-col-title">{titles ? titles[i] : `Viés ${c.label}`}</h2>
            {children[i]}
          </section>
        ))}
      </div>
    </div>
  );
}
