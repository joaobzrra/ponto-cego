import Link from "next/link";
import { ClusterMeter } from "@/components/cluster-meter";
import { ageCaption, type Blindspot } from "@/lib/blindspots";
import { subnoticiados } from "@/lib/classification";
import { PerfilVies } from "@/app/(public)/perfil-vies";
import { Headline } from "./headline";
import { SectionHead } from "./section-head";

/*
 * Blindspot cards (spec §3): featured, weekly, side-pair overlay, topic tag
 * card. Anatomy on every card with a picture: caption above, picture, meter
 * below, headline. The absent side is spelled out in text in its colour —
 * never colour or a gap alone.
 */
const thumb = (p: string) => `/thumbs/${p.replace(/\\/g, "/")}`;
const outletsWord = (n: number) => (n === 1 ? "veículo" : "veículos");
const caption = (b: Blindspot) => `(${b.totalOutlets} ${outletsWord(b.totalOutlets)} · ${ageCaption(b.firstAt)})`;
/*
 * Bias is a property of the ARTICLE's framing, never the outlet's reputation.
 * `sides` counts distinct outlets whose ARTICLE was banded to that side
 * (classification.ts `subnoticiados`), so the old "N veículos de direita"
 * wording attributed a leaning to the outlet itself and contradicted the
 * rubric. Name the framing, not the publisher.
 */
const framingWord = (n: number) => (n === 1 ? "enquadramento" : "enquadramentos");
const weakLabel = (b: Blindspot) => {
  const n = b.sides[b.weakSide];
  return n === 0
    ? `nenhum enquadramento de ${b.weakSide}`
    : `${n} ${framingWord(n)} de ${b.weakSide}`;
};

function Card({ b, chips, featured }: { b: Blindspot; chips: string[]; featured?: boolean }) {
  return (
    <article className={featured ? "pc-bcard pc-bcard--featured" : "pc-bcard"} data-side={b.weakSide}>
      <Link href={`/e/${b.clusterId}`} className="pc-home-link">
        <span className="pc-caption-arrow">
          {caption(b)} <span className="arrow">⟶</span>
        </span>
        {b.thumbnailPath && (
          <div className="pc-bcard-thumb">
            <img src={thumb(b.thumbnailPath)} alt="" />
          </div>
        )}
        <ClusterMeter sides={b.sides} labels="inside" />
        <Headline title={b.title} chips={chips} />
        <span className="pc-bcard-zero" style={{ color: `var(--vies-${b.weakSide})` }}>
          {weakLabel(b)}
        </span>
      </Link>
    </article>
  );
}

export function FeaturedBlindspot({ b, chips }: { b: Blindspot; chips: string[] }) {
  return (
    <section className="pc-rail-feat" aria-label="Ponto cego do dia">
      <SectionHead label="Ponto cego do dia" />
      <Card b={b} chips={chips} featured />
    </section>
  );
}

export function WeeklyBlindspots({ items, chips }: { items: Blindspot[]; chips: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="pc-rail-weekly" aria-label="O que não saiu dos noticiários esta semana">
      <SectionHead label="O que não saiu dos noticiários esta semana" />
      {items.map((b) => (
        <Card key={b.clusterId} b={b} chips={chips} />
      ))}
      <p className="pc-sub-note">eventos com 4+ veículos onde um lado publicou ≤20%, 7 dias</p>
    </section>
  );
}

/** Overlay card of the side pair under Tópicos em Alta (hero pattern). */
export function PairCard({ b }: { b: Blindspot }) {
  return (
    <article className="pc-pair-card" data-side={b.weakSide}>
      <Link href={`/e/${b.clusterId}`} className="pc-home-link">
        <span className="pc-caption-arrow">
          {caption(b)} <span className="arrow">⟶</span>
        </span>
        <figure className="pc-hero2-fig pc-pair-fig">
          {b.thumbnailPath && <img src={thumb(b.thumbnailPath)} alt="" />}
          <figcaption className="pc-hero2-titlebox">
            <span className="pc-kicker" style={{ color: `var(--vies-${b.weakSide})` }}>
              Ponto cego na {b.weakSide} · {b.totalOutlets} {outletsWord(b.totalOutlets)}
            </span>
            <h3 className="pc-hero2-title pc-pair-title">{b.title}</h3>
          </figcaption>
        </figure>
        <ClusterMeter sides={b.sides} labels="inside" />
      </Link>
    </article>
  );
}

/** Topic-section card: caption, picture, side tag, headline. No meter (spec §4). */
export function TopicBlindspotCard({ b, chips }: { b: Blindspot; chips: string[] }) {
  const pct = Math.round(b.weakShare * 100);
  const tag = pct === 0 ? `0% ${b.weakSide}` : `só ${pct}% ${b.weakSide}`;
  return (
    <article className="pc-tcard" data-side={b.weakSide}>
      <Link href={`/e/${b.clusterId}`} className="pc-home-link">
        <span className="pc-caption-arrow">
          {caption(b)} <span className="arrow">⟶</span>
        </span>
        {b.thumbnailPath && (
          <div className="pc-thumb16">
            <img src={thumb(b.thumbnailPath)} alt="" />
          </div>
        )}
        <div className="pc-tcard-tags">
          <span className="pc-tcard-tag" style={{ background: `var(--vies-${b.weakSide})` }}>{tag}</span>
          <span className="pc-tcard-n">{b.totalOutlets} {outletsWord(b.totalOutlets)}</span>
        </div>
        <Headline title={b.title} chips={chips} className="pc-tcard-title" />
      </Link>
    </article>
  );
}

/** /noticias keeps a rail: perfil + the weekly list, self-fetching. */
export async function NoticiasRail() {
  const ranked = await subnoticiados();
  return (
    <aside className="pc-rail">
      <PerfilVies />
      <WeeklyBlindspots items={ranked.slice(0, 5)} chips={[]} />
    </aside>
  );
}
