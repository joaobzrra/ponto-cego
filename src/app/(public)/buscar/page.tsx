import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { ArticleCard, type ArticleRow } from "@/components/article-card";
import { BAND_LABEL } from "@/components/bias";
import { LockedPage } from "@/components/locked";
import { BANDS, type Band } from "@/db/schema";
import { CATEGORIES } from "@/lib/llm";
import { previewAllowed, readAnonSessionId } from "@/lib/preview";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";

// Search-results pages stay out of the index permanently (noindex, follow).
export const metadata = pageMeta({
  path: "/buscar",
  title: "Buscar",
  description: "Busque notícias em todos os lados do espectro de uma vez.",
  noindex: true,
});

const LIMIT = 60;

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Search (stage 6 addition): free text over title/excerpt with multi-select
 * band and outlet filters — the reader can deliberately look across every
 * side at once, which is the whole point of the product.
 */
export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await previewAllowed())) return <LockedPage />;

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const selBands = asArray(params.banda).filter((b): b is Band =>
    (BANDS as readonly string[]).includes(b),
  );
  const selOutlets = asArray(params.veiculo)
    .map(Number)
    .filter(Number.isInteger);
  const selCategories = asArray(params.categoria).filter((c) =>
    (CATEGORIES as readonly string[]).includes(c),
  );

  const outlets = await db
    .select({ id: tables.outlets.id, name: tables.outlets.name })
    .from(tables.outlets)
    .where(eq(tables.outlets.enabled, true))
    .orderBy(tables.outlets.name);

  // The fieldset only renders once the classifier (rubric v4+) has actually
  // written categories — an empty filter would just confuse pre-v4 testers.
  const catRows = await db
    .selectDistinct({ category: tables.articles.category })
    .from(tables.articles)
    .where(isNotNull(tables.articles.category));
  const presentCategories = CATEGORIES.filter((c) => catRows.some((r) => r.category === c));

  const conditions = [
    eq(tables.articles.status, "published"),
    isNull(tables.articles.duplicateOf),
  ];
  if (q) {
    const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;
    conditions.push(
      or(ilike(tables.articles.title, pattern), ilike(tables.articles.excerpt, pattern))!,
    );
  }
  if (selBands.length > 0) conditions.push(inArray(tables.articles.band, selBands));
  if (selOutlets.length > 0) conditions.push(inArray(tables.articles.outletId, selOutlets));
  if (selCategories.length > 0) conditions.push(inArray(tables.articles.category, selCategories));

  const hasQuery = q || selBands.length > 0 || selOutlets.length > 0 || selCategories.length > 0;
  const rows: ArticleRow[] = hasQuery
    ? await db
        .select({
          article: tables.articles,
          outletName: tables.outlets.name,
          outletSlug: tables.outlets.slug,
          outletWarning: tables.outlets.warningLabel,
        })
        .from(tables.articles)
        .innerJoin(tables.outlets, eq(tables.outlets.id, tables.articles.outletId))
        .where(and(...conditions))
        .orderBy(desc(sql`coalesce(${tables.articles.publishedAt}, ${tables.articles.fetchedAt})`))
        .limit(LIMIT)
    : [];

  // First-party search event (server-side: query and result count are right
  // here). Zero-result queries surface coverage gaps in the admin dashboard.
  // Best-effort: measurement must never break search; page renders can't set
  // cookies, so a first-ever request without pc_sess is simply not counted.
  const sessionId = q ? await readAnonSessionId() : null;
  if (q && sessionId) {
    try {
      await db.insert(tables.events).values({
        sessionId,
        type: "search",
        path: "/buscar",
        query: q.toLowerCase().slice(0, 80),
        resultCount: rows.length,
      });
    } catch {
      // métrica é melhor-esforço
    }
  }

  return (
    <>
      <p className="pc-method">
        Busca no acervo completo — título e trecho, com filtros por faixa,
        categoria e veículo.
      </p>

      <form
        className="pc-search"
        action="/buscar"
        method="get"
        role="search"
        style={{ marginTop: "1.25rem" }}
      >
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar artigos — título ou trecho"
          aria-label="Buscar artigos"
        />
        <button type="submit">Buscar</button>
      </form>

      <form className="pc-filters" action="/buscar" method="get">
        <input type="hidden" name="q" value={q} />
        <fieldset>
          <legend>Faixas</legend>
          {BANDS.map((b) => (
            <label key={b}>
              <input type="checkbox" name="banda" value={b} defaultChecked={selBands.includes(b)} />
              {b === "NC" ? "Não classificável" : BAND_LABEL[b]}
            </label>
          ))}
        </fieldset>
        {presentCategories.length > 0 && (
          <fieldset>
            <legend>Categorias</legend>
            {presentCategories.map((c) => (
              <label key={c}>
                <input
                  type="checkbox"
                  name="categoria"
                  value={c}
                  defaultChecked={selCategories.includes(c)}
                />
                {c}
              </label>
            ))}
          </fieldset>
        )}
        <fieldset>
          <legend>Veículos</legend>
          {outlets.map((o) => (
            <label key={o.id}>
              <input
                type="checkbox"
                name="veiculo"
                value={o.id}
                defaultChecked={selOutlets.includes(o.id)}
              />
              {o.name}
            </label>
          ))}
        </fieldset>
        <button type="submit">Filtrar</button>
      </form>

      <main>
        {!hasQuery && (
          <p className="pc-side-note">Digite um termo ou selecione filtros para buscar.</p>
        )}
        {hasQuery && rows.length === 0 && (
          <p className="pc-side-note">Nada encontrado — tente outro termo ou menos filtros.</p>
        )}
        {rows.length > 0 && (
          <>
            <p className="pc-card-meta" style={{ marginBottom: "0.8rem" }}>
              {rows.length === LIMIT ? `${LIMIT}+ resultados` : `${rows.length} resultado${rows.length === 1 ? "" : "s"}`}
            </p>
            <div className="pc-results">
              {rows.map((r) => (
                <ArticleCard key={r.article.id} row={r} />
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
