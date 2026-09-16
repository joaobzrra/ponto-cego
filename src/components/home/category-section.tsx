import Link from "next/link";
import { ClusterMeter } from "@/components/cluster-meter";
import type { CategorySection as CategorySectionData, ClusterCard } from "@/lib/topics";
import { captionText } from "./caption-arrow";
import { Headline } from "./headline";
import { NewsletterBox } from "./newsletter-box";
import { SectionHead } from "./section-head";

/*
 * Category section (spec §7): Geopolítica, Economia and one rotating thin
 * category. Lead 6/12 (caption, picture, meter, 26px headline) and three
 * stacked picture items 6/12 (thumbnail left, caption, meter, 15px
 * headline), with the newsletter box at the foot of that column (owner
 * ruling 2026-09-04). Not blindspots — the category's most-covered clusters.
 */
const thumb = (p: string) => `/thumbs/${p.replace(/\\/g, "/")}`;

function Item({ c, chips }: { c: ClusterCard; chips: string[] }) {
  return (
    <article className="pc-cat-item">
      <Link href={`/e/${c.clusterId}`} className="pc-home-link pc-cat-item-grid">
        {c.thumbnailPath && (
          <div className="pc-cat-item-thumb">
            <img src={thumb(c.thumbnailPath)} alt="" />
          </div>
        )}
        <span className="pc-caption-arrow">
          {captionText(c.outlets)} <span className="arrow">⟶</span>
        </span>
        <ClusterMeter sides={c.sides} labels="inside" />
        <Headline title={c.title} chips={chips} className="pc-cat-item-title" />
      </Link>
    </article>
  );
}

export function CategorySection({ c, chips }: { c: CategorySectionData; chips: string[] }) {
  return (
    <section className="pc-sec pc-sec--cat" aria-label={c.category}>
      <SectionHead label={c.category} sub={`${c.artsToday} artigos hoje`} />
      <div className="pc-sec-cols pc-sec-cols--6-6">
        <div className="pc-sec-lead">
          <Link href={`/e/${c.lead.clusterId}`} className="pc-home-link">
            <span className="pc-caption-arrow">
              {captionText(c.lead.outlets)} <span className="arrow">⟶</span>
            </span>
            {c.lead.thumbnailPath && (
              <div className="pc-thumb16">
                <img src={thumb(c.lead.thumbnailPath)} alt="" />
              </div>
            )}
            <ClusterMeter sides={c.lead.sides} labels="inside" />
            <Headline title={c.lead.title} chips={chips} className="pc-cat-lead-title" />
          </Link>
        </div>
        <div className="pc-cat-items">
          {c.more.map((m) => (
            <Item key={m.clusterId} c={m} chips={chips} />
          ))}
          <NewsletterBox />
        </div>
      </div>
    </section>
  );
}
