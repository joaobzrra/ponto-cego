import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, tables } from "@/db";
import { ArticleCard, type ArticleRow } from "@/components/article-card";
import { LockedPage } from "@/components/locked";
import type { Band } from "@/db/schema";
import { previewAllowed } from "@/lib/preview";
import { pageMeta } from "@/lib/seo";
import { ColumnTabs } from "../../column-tabs";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 7;
const PER_COLUMN = 20;
const NC_LIMIT = 12;

const SIDES: Array<{ bands: Band[] }> = [
  { bands: ["E3", "E2", "E1"] },
  { bands: ["C"] },
  { bands: ["D1", "D2", "D3"] },
];

/** Case-insensitive membership test against the keywords jsonb array. */
function keywordMatch(kw: string) {
  return sql`exists (
    select 1 from jsonb_array_elements_text(${tables.articles.keywords}) as k
    where lower(k) = ${kw.toLowerCase()}
  )`;
}

async function topicArticles(kw: string, bands: Band[] | null): Promise<ArticleRow[]> {
  return db
    .select({
      article: tables.articles,
      outletName: tables.outlets.name,
      outletSlug: tables.outlets.slug,
      outletWarning: tables.outlets.warningLabel,
    })
    .from(tables.articles)
    .innerJoin(tables.outlets, eq(tables.outlets.id, tables.articles.outletId))
    .where(
      and(
        eq(tables.articles.status, "published"),
        isNull(tables.articles.duplicateOf),
        bands ? inArray(tables.articles.band, bands) : eq(tables.articles.band, "NC"),
        gte(tables.articles.fetchedAt, new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)),
        keywordMatch(kw),
      ),
    )
    // coalesce: plain `desc(published_at)` would float NULL pubDates to the top.
    .orderBy(desc(sql`coalesce(${tables.articles.publishedAt}, ${tables.articles.fetchedAt})`))
    .limit(bands ? PER_COLUMN : NC_LIMIT);
}

/**
 * Topic page (/t/[kw]) — how each side is covering one keyword this week.
 * The tri-column spectrum view filtered to a theme: the product's pitch in
 * miniature, powered by classifier keywords until stage 5 cluster pages
 * take over the event-level version of this.
 */
export async function generateMetadata({ params }: { params: Promise<{ kw: string }> }) {
  const { kw: raw } = await params;
  const kw = decodeURIComponent(raw).trim();
  return pageMeta({
    path: `/t/${encodeURIComponent(kw)}`,
    title: kw,
    description: `Como cada lado do espectro cobriu "${kw}" nos últimos ${WINDOW_DAYS} dias — esquerda, centro e direita lado a lado.`,
  });
}

export default async function TopicPage({ params }: { params: Promise<{ kw: string }> }) {
  if (!(await previewAllowed())) return <LockedPage />;

  const { kw: raw } = await params;
  const kw = decodeURIComponent(raw).trim();
  if (!kw || kw.length > 80) notFound();

  const [cols, ncArticles] = await Promise.all([
    Promise.all(SIDES.map((s) => topicArticles(kw, s.bands))),
    topicArticles(kw, null),
  ]);
  const total = cols.flat().length + ncArticles.length;
  const initialIndex = Math.floor(Math.random() * 3);

  return (
    <>
      <p className="pc-method" style={{ margin: "0.9rem 0 1.1rem" }}>
        Tópico: <strong style={{ color: "var(--text)" }}>{kw}</strong> — como cada
        lado cobriu nos últimos {WINDOW_DAYS} dias
        {total > 0 ? ` (${total} artigo${total === 1 ? "" : "s"})` : ""}. Viés é do
        artigo, nunca do assunto.
      </p>

      <main>
        {total === 0 ? (
          <p className="pc-card-meta">
            Nada sobre “{kw}” nos últimos {WINDOW_DAYS} dias.{" "}
            <Link href="/buscar">Buscar no acervo →</Link>
          </p>
        ) : (
          <>
            <ColumnTabs initialIndex={initialIndex}>
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  {cols[i].map((row) => (
                    <ArticleCard key={row.article.id} row={row} />
                  ))}
                  {cols[i].length === 0 && (
                    <p className="pc-card-meta">Nenhuma cobertura desta faixa em {WINDOW_DAYS}d.</p>
                  )}
                </div>
              )) as [React.ReactNode, React.ReactNode, React.ReactNode]}
            </ColumnTabs>

            {ncArticles.length > 0 && (
              <section style={{ marginTop: "1.5rem" }}>
                <h2 className="pc-col-title" style={{ borderBottomColor: "var(--border)" }}>
                  Fora do espectro político (NC)
                </h2>
                <div className="pc-results">
                  {ncArticles.map((row) => (
                    <ArticleCard key={row.article.id} row={row} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
