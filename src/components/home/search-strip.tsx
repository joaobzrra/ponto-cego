import Link from "next/link";
import type { Chip } from "@/lib/home";

/*
 * Search strip (spec §1): one 56px row between the nav and the H1 band,
 * home only. Left: the same GET form the header has, wide. Right: EM ALTA +
 * velocity-ranked chips, one row, clipped with a fade (no wrap). The trend
 * mark is inline line-art SVG — never a glyph or emoji.
 */
const Trend = () => (
  <svg viewBox="0 0 16 10" width="12" height="8" aria-hidden fill="none">
    <path d="M1 9 6 4l3 3 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M11 1h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

export function SearchStrip({ chips }: { chips: Chip[] }) {
  return (
    <div className="pc-strip">
      <form className="pc-strip-form" action="/buscar" method="get" role="search">
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden fill="none">
          <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.5" />
          <line x1="13" y1="13" x2="17.5" y2="17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          id="busca-home"
          type="search"
          name="q"
          placeholder="Buscar um assunto, pessoa ou lei…"
          aria-label="Buscar um assunto, pessoa ou lei"
        />
        <button type="submit" className="pc-strip-btn">Buscar</button>
      </form>
      {chips.length > 0 && (
        <div className="pc-strip-chips" aria-label="Em alta">
          <span className="pc-strip-lbl">Em alta</span>
          <div className="pc-strip-row">
            {chips.map((c) => (
              <Link key={c.kw} href={`/t/${encodeURIComponent(c.kw)}`} className="pc-chip">
                <Trend /> {c.kw}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
