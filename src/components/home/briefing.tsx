import Link from "next/link";
import { ClusterMeter } from "@/components/cluster-meter";
import type { Briefing as BriefingData } from "@/lib/home";
import { captionText } from "./caption-arrow";
import { Headline } from "./headline";
import { SectionHead } from "./section-head";

/*
 * Resumo do dia (spec §2): the five most-covered clusters of the day, each
 * with caption ABOVE the thumbnail, meter BELOW it, headline, then the one
 * machine line. RESUMO AUTOMÁTICO tag at the foot; no explanatory prose.
 * A missing line renders nothing in its place — never a placeholder.
 */
export function Briefing({ b, chips }: { b: BriefingData; chips: string[] }) {
  // aria-label, not aria-labelledby: SectionHead's h2 carries no id.
  return (
    <section className="pc-brief" aria-label="Resumo do dia">
      <SectionHead
        label="Resumo do dia"
        sub={`${b.items.length} ${b.items.length === 1 ? "assunto" : "assuntos"} · ${b.arts} artigos · ${b.minutes} min`}
      />
      <ul className="pc-brief-list">
        {b.items.map((it) => (
          <li key={it.clusterId} className="pc-brief-item">
            <Link href={`/e/${it.clusterId}`} className="pc-home-link">
              <span className="pc-caption-arrow">
                {captionText(it.outlets)} <span className="arrow">⟶</span>
              </span>
              {it.thumbnailPath && (
                <div className="pc-thumb16">
                  <img src={`/thumbs/${it.thumbnailPath.replace(/\\/g, "/")}`} alt="" />
                </div>
              )}
              <ClusterMeter sides={it.sides} labels="inside" />
              <Headline title={it.title} chips={chips} />
              {it.line && <p className="pc-brief-line">{it.line}</p>}
            </Link>
          </li>
        ))}
      </ul>
      <div className="pc-brief-foot">
        <span className="pc-tag">Resumo automático</span>
      </div>
    </section>
  );
}
