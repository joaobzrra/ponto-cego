import Link from "next/link";
import { ClusterMeter } from "@/components/cluster-meter";
import type { Hero } from "@/lib/home";
import { CaptionArrow } from "./caption-arrow";

/*
 * Destaque do Dia, wireframe grammar: grayscale image with the headline ON it
 * (bottom scrim), then the meter with its %s underneath the bar, then the
 * vehicle-count caption. Three variants share the shape:
 *   approved — admin-approved synthesis (no image; text is the hero)
 *   cluster  — the auto pick: biggest distinct-outlet coverage of 24h
 *   interim  — keyword fallback for when clustering has nothing (cap pauses)
 */
export function HomeHero({ hero }: { hero: Hero | null }) {
  if (!hero) {
    return (
      <p className="pc-side-note" style={{ marginTop: "0.4rem" }}>
        Sem destaque no momento — o painel volta a se preencher com o próximo
        ciclo de coleta.
      </p>
    );
  }

  if (hero.kind === "approved") {
    const d = hero.d;
    return (
      <article className="pc-hero2">
        <h2 className="pc-hero2-title">{d.title}</h2>
        <p className="pc-hero2-synthesis">{d.synthesis}</p>
        <div className="pc-hero2-meta">
          <span className="pc-caption-arrow">{d.sourceCount} veículos cobrindo</span>
        </div>
      </article>
    );
  }

  if (hero.kind === "cluster") {
    const c = hero.c;
    return (
      <article className="pc-hero2">
        <Link href={`/e/${c.clusterId}`} className="pc-home-link">
          {c.thumbnailPath ? (
            // Headline lives INSIDE the image over the bottom-to-top scrim;
            // the meter sits under the title, %s under the bar.
            <>
              <figure className="pc-hero2-fig">
                <img src={`/thumbs/${c.thumbnailPath.replace(/\\/g, "/")}`} alt="" />
                <figcaption className="pc-hero2-titlebox">
                  <h2 className="pc-hero2-title">{c.title}</h2>
                </figcaption>
              </figure>
              <ClusterMeter sides={c.sides} labels="inside" />
            </>
          ) : (
            <>
              <h2 className="pc-hero2-title">{c.title}</h2>
              <ClusterMeter sides={c.sides} labels="inside" />
            </>
          )}
          <div className="pc-hero2-meta">
            <CaptionArrow outlets={c.outlets} />
          </div>
        </Link>
      </article>
    );
  }

  const h = hero.h;
  const sides = {
    esquerda: h.bands.esquerda,
    centro: h.bands.centro,
    direita: h.bands.direita,
  };
  return (
    <article className="pc-hero2">
      <Link href={`/a/${h.article.id}`} className="pc-home-link">
        {h.article.thumbnailPath ? (
          <>
            <figure className="pc-hero2-fig">
              <img src={`/thumbs/${h.article.thumbnailPath.replace(/\\/g, "/")}`} alt="" />
              <figcaption className="pc-hero2-titlebox">
                <h2 className="pc-hero2-title">{h.article.title}</h2>
              </figcaption>
            </figure>
            <ClusterMeter sides={sides} labels="inside" />
          </>
        ) : (
          <>
            <h2 className="pc-hero2-title">{h.article.title}</h2>
            <ClusterMeter sides={sides} labels="inside" />
          </>
        )}
      </Link>
      <div className="pc-hero2-meta">
        <span className="pc-caption-arrow">{h.outletCount} veículos</span>
        <Link href={`/t/${encodeURIComponent(h.kw)}`} className="pc-caption-arrow">
          mais sobre {h.kw} <span className="arrow">⟶</span>
        </Link>
      </div>
    </article>
  );
}
