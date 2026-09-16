import { AltaCard } from "@/components/home/alta-card";
import { FeaturedBlindspot, PairCard, WeeklyBlindspots } from "@/components/home/blindspot-cards";
import { Briefing } from "@/components/home/briefing";
import { CategorySection } from "@/components/home/category-section";
import { HomeHero } from "@/components/home/hero";
import { PatronoBlock } from "@/components/home/patrono-block";
import { SearchStrip } from "@/components/home/search-strip";
import { SectionHead } from "@/components/home/section-head";
import { SidesBand } from "@/components/home/sides-band";
import { TopicSection } from "@/components/home/topic-section";
import { SiteJsonLd } from "@/components/json-ld";
import { LockedPage } from "@/components/locked";
import { homeData } from "@/lib/home";
import { previewAllowed } from "@/lib/preview";
import { siteUrl } from "@/lib/seo";
import { PerfilVies } from "./perfil-vies";

export const dynamic = "force-dynamic";
export const metadata = { alternates: { canonical: `${siteUrl()}/` } };

/*
 * Front page "daily battle" (spec 2026-09-03):
 *   strip    search + EM ALTA chips (home only)
 *   sides    Mais noticiados (centred H1 + legend) — the page opens with images
 *   brief    Resumo do dia (340px)            centre  hero + Tópicos em Alta + side pair + patrono
 *   rail     Ponto cego do dia + weekly + perfil (260px)
 *   then three topic sections and three category sections.
 * All data + the one cluster-consumption order live in src/lib/home.ts.
 */
export default async function Home() {
  if (!(await previewAllowed())) return <LockedPage />;
  const d = await homeData();
  const chips = d.chips.map((c) => c.kw);

  return (
    <>
      <SiteJsonLd />
      <SearchStrip chips={d.chips} />
      <div className={d.briefing ? "pc-home" : "pc-home pc-home--nobrief"}>
        <SidesBand cols={d.bottom} />

        {d.briefing && <Briefing b={d.briefing} chips={chips} />}

        <section className="pc-centre">
          <div className="pc-home-hero" aria-label="Destaque do dia">
            <HomeHero hero={d.hero} />
          </div>
          <section className="pc-home-alta" aria-label="Tópicos em alta">
            <SectionHead label="Tópicos em Alta" sub="hoje" />
            {d.alta.length === 0 ? (
              <p className="pc-side-note">Ainda sem eventos com cobertura múltipla nas últimas 24h.</p>
            ) : (
              d.alta.map((c) => <AltaCard key={c.clusterId} c={c} chips={chips} />)
            )}
          </section>
          {(d.pair.direita || d.pair.esquerda) && (
            <div className="pc-pair">
              {d.pair.direita && <PairCard b={d.pair.direita} />}
              {d.pair.esquerda && <PairCard b={d.pair.esquerda} />}
            </div>
          )}
          <PatronoBlock />
        </section>

        <aside className="pc-rail">
          {d.featured && <FeaturedBlindspot b={d.featured} chips={chips} />}
          <WeeklyBlindspots items={d.weekly} chips={chips} />
          <PerfilVies />
        </aside>
      </div>

      {d.topics.map((t) => (
        <TopicSection key={t.kw} t={t} chips={chips} />
      ))}
      {d.categories.map((c) => (
        <CategorySection key={c.category} c={c} chips={chips} />
      ))}
    </>
  );
}
