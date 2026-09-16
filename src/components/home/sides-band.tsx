import Link from "next/link";
import { ClusterMeter } from "@/components/cluster-meter";
import type { BottomColumn } from "@/lib/home";
import { MeterLegend } from "@/components/meter-legend";
import { captionText } from "./caption-arrow";

/*
 * Sides band (top of the home page since 2026-09-02, was the bottom band):
 * what each side is talking about most (H1 "Mais noticiados", centred with
 * the legend; owner review 2026-09-03). Per column — the side's
 * name in its data color, the side's own top keyword as kicker, its latest
 * illustrated headline, and the keyword's FULL-spectrum meter (the point:
 * you see how the rest of the spectrum treats the side's favorite subject).
 */
export function SidesBand({ cols }: { cols: BottomColumn[] }) {
  return (
    <section className="pc-sides" aria-labelledby="pc-sides-h1">
      <h1 id="pc-sides-h1" className="pc-sides-h1">
        Mais noticiados
      </h1>
      <MeterLegend />
      <div className="pc-sides-cols">
      {cols.map((col) => (
        <div key={col.side} className="pc-sides-col">
          <h2 className="pc-sides-side" style={{ color: `var(--vies-${col.side})` }}>
            {col.side}
          </h2>
          {col.item ? (
            <article>
              <div className="pc-kicker">{col.item.kw}</div>
              <Link
                href={`/t/${encodeURIComponent(col.item.kw)}`}
                className="pc-caption-arrow"
              >
                {captionText(col.item.outlets, col.item.hours)}{" "}
                <span className="arrow">⟶</span>
              </Link>
              <Link href={`/a/${col.item.article.id}`} className="pc-home-link">
                {col.item.article.thumbnailPath && (
                  <div className="pc-sides-thumb">
                    <img
                      src={`/thumbs/${col.item.article.thumbnailPath.replace(/\\/g, "/")}`}
                      alt=""
                    />
                  </div>
                )}
                <ClusterMeter sides={col.item.sides} labels="inside" />
                <h3 className="pc-home-title">{col.item.article.title}</h3>
              </Link>
            </article>
          ) : (
            <p className="pc-side-note">
              Sem cobertura de {col.side} nas últimas 24h.
            </p>
          )}
        </div>
      ))}
      </div>
    </section>
  );
}
