import Link from "next/link";
import { ClusterMeter } from "@/components/cluster-meter";
import type { TopicSection as TopicSectionData } from "@/lib/topics";
import { TopicBlindspotCard } from "./blindspot-cards";
import { captionText } from "./caption-arrow";
import { Headline } from "./headline";
import { NewsletterBox } from "./newsletter-box";
import { SectionHead } from "./section-head";

/*
 * Topic section (spec §6, Ground News "US Politics" pattern): keyword label
 * on a 2px rule with one Ver mais button; left 7/12 the keyword's largest
 * 24h cluster with the headline overlaid on the image (caption above, meter
 * below); right 5/12 up to three blindspot cards inside the keyword, the
 * third full-width under the pair, and the newsletter box under the cards in
 * EVERY section (owner ruling 2026-09-04: fill the empty foot of the column).
 * No Seguir button — no follow feature.
 */
export function TopicSection({ t, chips }: { t: TopicSectionData; chips: string[] }) {
  const [a, b, c] = t.blindspots;
  return (
    <section className="pc-sec pc-sec--topic" aria-label={t.kw}>
      <SectionHead
        label={t.kw}
        right={
          <Link href={`/t/${encodeURIComponent(t.kw)}`} className="pc-btn pc-btn--ghost">
            Ver mais
          </Link>
        }
      />
      <div className="pc-sec-cols pc-sec-cols--7-5">
        <div className="pc-sec-lead">
          <p className="pc-kicker">Últimas em {t.kw}</p>
          <Link href={`/e/${t.lead.clusterId}`} className="pc-home-link">
            <span className="pc-caption-arrow">
              {captionText(t.lead.outlets)} <span className="arrow">⟶</span>
            </span>
            <figure className="pc-hero2-fig pc-sec-fig">
              {t.lead.thumbnailPath && (
                <img src={`/thumbs/${t.lead.thumbnailPath.replace(/\\/g, "/")}`} alt="" />
              )}
              <figcaption className="pc-hero2-titlebox">
                <Headline title={t.lead.title} chips={chips} className="pc-hero2-title" />
              </figcaption>
            </figure>
            <ClusterMeter sides={t.lead.sides} labels="inside" />
          </Link>
        </div>
        <div className="pc-sec-side">
          <p className="pc-kicker">Pontos cegos em {t.kw}</p>
          <div className="pc-sec-two">
            {a && <TopicBlindspotCard b={a} chips={chips} />}
            {b && <TopicBlindspotCard b={b} chips={chips} />}
          </div>
          {c && (
            <div className="pc-sec-third">
              <TopicBlindspotCard b={c} chips={chips} />
            </div>
          )}
          <div className="pc-sec-nl">
            <NewsletterBox />
          </div>
        </div>
      </div>
    </section>
  );
}
