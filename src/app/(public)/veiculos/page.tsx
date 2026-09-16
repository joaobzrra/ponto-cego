import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { db, tables } from "@/db";
import {
  BandSilhouette,
  DivergingBar,
  POLITICAL_BANDS,
  SMALL_SAMPLE,
  outletSide,
} from "@/components/bias";
import { WarningBadge } from "@/components/warning-badge";
import { LockedPage } from "@/components/locked";
import { outletAggregate, type OutletAggregate } from "@/lib/classification";
import { previewAllowed } from "@/lib/preview";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = pageMeta({
  path: "/veiculos",
  title: "Veículos",
  description:
    "Todos os veículos acompanhados: distribuição de viés dos últimos 90 dias, transparência de propriedade e principais assuntos de cada um.",
});

/** Top keywords per outlet (30d) in one grouped query — the "assuntos" line. */
async function topKeywordsByOutlet(): Promise<Map<number, string[]>> {
  const result = await db.execute(sql`
    select outlet_id, kw from (
      select ${tables.articles.outletId} as outlet_id, lower(kw) as kw,
             row_number() over (
               partition by ${tables.articles.outletId} order by count(*) desc
             ) as rn
      from ${tables.articles}, jsonb_array_elements_text(${tables.articles.keywords}) as kw
      where ${tables.articles.fetchedAt} > now() - interval '30 days'
        and ${tables.articles.status} = 'published'
        and length(kw) > 2
      group by ${tables.articles.outletId}, lower(kw)
    ) t where rn <= 5
  `);
  const map = new Map<number, string[]>();
  for (const row of result.rows as Array<{ outlet_id: number; kw: string }>) {
    const list = map.get(row.outlet_id) ?? [];
    list.push(row.kw);
    map.set(row.outlet_id, list);
  }
  return map;
}

type Side = "esquerda" | "centro" | "direita";
const SIDES: { key: Side; label: string }[] = [
  { key: "esquerda", label: "Esquerda" },
  { key: "centro", label: "Centro" },
  { key: "direita", label: "Direita" },
];

/**
 * Column placement = outletSide(): the 90-day mean band decides the column
 * and NOTHING else — it is never rendered, never sorted on, never printed.
 * Outlets with no political articles land in Centro, at the foot.
 */
function sideOfAggregate(agg: OutletAggregate): Side {
  return outletSide(agg.bandCounts, agg.politicalArticles);
}

const nf = new Intl.NumberFormat("pt-BR");

type Row = {
  o: typeof tables.outlets.$inferSelect;
  agg: OutletAggregate;
  side: Side;
};

/**
 * Veículos (redesign approved 2026-09-04): three side columns, as on the home's
 * Mais Noticiados, ordered inside each column by political volume (or by name
 * via ?ordem=nome). Each row is a <details>: the summary carries the outlet's
 * identity and its diverging seven-band bar; the body carries the silhouette,
 * the side percentages, the ownership line (verified only, with source), the
 * subjects and a link to its articles. Everything is server-rendered — no
 * client script, no hover requirement, whole row is the target.
 */
export default async function VeiculosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await previewAllowed())) return <LockedPage />;
  const params = await searchParams;
  const ordem = params.ordem === "nome" ? "nome" : "volume";

  const outlets = await db
    .select()
    .from(tables.outlets)
    .where(eq(tables.outlets.enabled, true))
    .orderBy(tables.outlets.name);
  const [aggs, keywords] = await Promise.all([
    Promise.all(outlets.map(async (o) => ({ o, agg: await outletAggregate(o.id) }))),
    topKeywordsByOutlet(),
  ]);

  const rows: Row[] = aggs.map(({ o, agg }) => ({ o, agg, side: sideOfAggregate(agg) }));
  const columns = SIDES.map((s) => {
    const list = rows.filter((r) => r.side === s.key);
    list.sort((a, b) =>
      ordem === "nome"
        ? a.o.name.localeCompare(b.o.name, "pt-BR")
        : b.agg.politicalArticles - a.agg.politicalArticles || a.o.name.localeCompare(b.o.name, "pt-BR"),
    );
    return { ...s, list };
  });

  let rowIndex = 0;

  return (
    <>
      <p className="pc-method">
        A posição de um veículo nunca é decretada: é a média móvel das faixas
        dos seus artigos políticos nos últimos 90 dias. Cada barra é a
        distribuição inteira, das sete faixas, pendurada no centro. Propriedade
        exibida apenas quando verificada, sempre com fonte pública.
      </p>

      <div className="pc-vsort">
        <span>Ordenar por</span>
        <Link href="/veiculos" aria-current={ordem === "volume" ? "page" : undefined}>
          volume
        </Link>
        <Link href="/veiculos?ordem=nome" aria-current={ordem === "nome" ? "page" : undefined}>
          nome
        </Link>
        <span className="pc-vsort-count">
          {outlets.length} veículos · 90 dias
        </span>
      </div>

      <main className="pc-vcols">
        {columns.map((col) => (
          <section key={col.key} className="pc-vcol">
            <header className="pc-vcol-head">
              <h2 className="pc-sides-side" style={{ color: `var(--vies-${col.key})` }}>
                {col.label}
              </h2>
              <span>
                {col.list.length} veículo{col.list.length === 1 ? "" : "s"} · média em 90 d
              </span>
            </header>
            <div className="pc-vcol-axis" aria-hidden="true">
              <span>◀ esquerda</span>
              <span>centro</span>
              <span>direita ▶</span>
            </div>
            {col.list.map(({ o, agg }) => {
              const delay = rowIndex++ * 25;
              const pol = agg.politicalArticles;
              const pct = (b: "E" | "C" | "D") =>
                pol === 0
                  ? 0
                  : Math.round(
                      (POLITICAL_BANDS.filter((x) => x.startsWith(b)).reduce(
                        (acc, x) => acc + (agg.bandCounts[x] ?? 0),
                        0,
                      ) /
                        pol) *
                        100,
                    );
              const total = pol + agg.ncArticles;
              const kws = keywords.get(o.id) ?? [];
              return (
                <details key={o.id} className="pc-orow">
                  <summary>
                    <span className="pc-orow-name">
                      {o.name} <WarningBadge label={o.warningLabel} />
                    </span>
                    {o.ownerVerified && o.ownerType && (
                      <span className="pc-orow-seal">{o.ownerType}</span>
                    )}
                    <DivergingBar counts={agg.bandCounts} politicalArticles={pol} delayMs={delay} />
                    <span className="pc-orow-count">
                      {nf.format(pol)} artigo{pol === 1 ? "" : "s"} político{pol === 1 ? "" : "s"}
                      {pol > 0 && pol < SMALL_SAMPLE && " · amostra pequena"}
                    </span>
                  </summary>
                  <div className="pc-orow-body">
                    <BandSilhouette counts={agg.bandCounts} politicalArticles={pol} />
                    {pol > 0 && (
                      <div className="pc-orow-pcts">
                        <span style={{ color: "var(--vies-esquerda)" }}>{pct("E")}% esquerda</span>
                        <span style={{ color: "var(--vies-centro)" }}>{pct("C")}% centro</span>
                        <span style={{ color: "var(--vies-direita)" }}>{pct("D")}% direita</span>
                      </div>
                    )}
                    <dl>
                      <dt>90 dias</dt>
                      <dd>
                        {nf.format(pol)} político{pol === 1 ? "" : "s"} · {nf.format(agg.ncArticles)}{" "}
                        não-político{agg.ncArticles === 1 ? "" : "s"}
                        {total > 0 && <> ({Math.round((agg.ncArticles / total) * 100)}%)</>}
                      </dd>
                      {o.ownerVerified && o.owner && (
                        <>
                          <dt>controle</dt>
                          <dd>
                            {o.ownerType && <>{o.ownerType} · </>}
                            {o.owner}
                            {o.ownerSourceUrl && (
                              <>
                                {" "}
                                <a href={o.ownerSourceUrl} target="_blank" rel="noopener">
                                  fonte ↗
                                </a>
                              </>
                            )}
                          </dd>
                        </>
                      )}
                      {kws.length > 0 && (
                        <>
                          <dt>assuntos</dt>
                          <dd className="pc-orow-kw">
                            {kws.map((kw) => (
                              <Link key={kw} href={`/t/${encodeURIComponent(kw)}`}>
                                {kw}
                              </Link>
                            ))}
                          </dd>
                        </>
                      )}
                      <dt>ver</dt>
                      <dd>
                        <Link href={`/buscar?veiculo=${o.id}`}>notícias deste veículo →</Link>
                      </dd>
                    </dl>
                  </div>
                </details>
              );
            })}
          </section>
        ))}
      </main>
    </>
  );
}
