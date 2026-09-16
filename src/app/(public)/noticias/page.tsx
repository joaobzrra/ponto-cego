import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import type { Band } from "@/db/schema";
import { ArticleCard, type ArticleRow } from "@/components/article-card";
import { LockedPage } from "@/components/locked";
import { type VoteAggregate } from "@/lib/feedback-display";
import { previewAllowed } from "@/lib/preview";
import { pageMeta } from "@/lib/seo";
import { ColumnTabs } from "../column-tabs";
import { NoticiasRail } from "@/components/home/blindspot-cards";

export const dynamic = "force-dynamic";

/*
 * Últimas Notícias — the tri-column article firehose (the original front
 * page, relocated here when the cluster/keyword home landed, Final-Wireframe
 * 2026-07-18): every side's latest 48h, side by side, equal weight.
 */

export const metadata = pageMeta({
  path: "/noticias",
  title: "Últimas Notícias",
  description:
    "As últimas notícias de esquerda, centro e direita lado a lado — viés estimado por artigo, nunca por veículo.",
});

const WINDOW_48H = 48 * 60 * 60 * 1000;
const PER_COLUMN = 30;
/** Wireframe rhythm: 3 illustrated rows, 3 text rows, the rest disclosed. */
const WITH_THUMB = 3;
const VISIBLE = 6;

const SIDES: Array<{ bands: Band[] }> = [
  { bands: ["E3", "E2", "E1"] },
  { bands: ["C"] },
  { bands: ["D1", "D2", "D3"] },
];

async function columnArticles(bands: Band[]): Promise<ArticleRow[]> {
  const rows = await db
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
        // Stage 5: syndicated wire copies never occupy card slots.
        isNull(tables.articles.duplicateOf),
        inArray(tables.articles.band, bands),
        gte(tables.articles.fetchedAt, new Date(Date.now() - WINDOW_48H)),
      ),
    )
    // coalesce: plain `desc(published_at)` would float NULL pubDates to the top.
    .orderBy(desc(sql`coalesce(${tables.articles.publishedAt}, ${tables.articles.fetchedAt})`))
    .limit(PER_COLUMN);
  // Same outlet, same headline via two feed scopes → one slot (stage 5 dedup
  // is cross-outlet only and doesn't cover this).
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.outletSlug}|${r.article.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One grouped query for all cards' vote aggregates (spec §9 display rule). */
async function voteAggregates(articleIds: number[]): Promise<Map<number, VoteAggregate>> {
  if (articleIds.length === 0) return new Map();
  const rows = await db
    .select({
      articleId: tables.feedback.articleId,
      agree: sql<number>`count(*) filter (where ${tables.feedback.direction} = 'agree')`,
      total: sql<number>`count(*)`,
    })
    .from(tables.feedback)
    .where(inArray(tables.feedback.articleId, articleIds))
    .groupBy(tables.feedback.articleId);
  return new Map(
    rows.map((r) => [r.articleId, { agree: Number(r.agree), total: Number(r.total) }]),
  );
}

function Column({ rows, votes }: { rows: ArticleRow[]; votes: Map<number, VoteAggregate> }) {
  if (rows.length === 0) {
    return <p className="pc-card-meta" style={{ marginTop: "0.8rem" }}>Sem artigos nesta coluna nas últimas 48h.</p>;
  }
  const card = (row: ArticleRow, thumb: boolean) => (
    <ArticleCard key={row.article.id} row={row} votes={votes.get(row.article.id)} thumb={thumb} />
  );
  return (
    <>
      {rows.slice(0, WITH_THUMB).map((r) => card(r, true))}
      {rows.slice(WITH_THUMB, VISIBLE).map((r) => card(r, false))}
      {rows.length > VISIBLE && (
        <details className="pc-more">
          <summary>Ver mais notícias</summary>
          {rows.slice(VISIBLE).map((r) => card(r, false))}
        </details>
      )}
    </>
  );
}

export default async function NoticiasPage() {
  if (!(await previewAllowed())) return <LockedPage />;

  const cols = await Promise.all(SIDES.map((s) => columnArticles(s.bands)));
  const votes = await voteAggregates(cols.flat().map((r) => r.article.id));

  // Random initial mobile tab per request — no side gets default exposure.
  const initialIndex = Math.floor(Math.random() * 3);

  return (
    <>
      <p className="pc-method">
        Viés estimado por artigo, nunca por veículo. Rótulos em calibração —
        discorde pelos botões em cada artigo.
      </p>

      <div className="pc-tri">
        <main>
          <ColumnTabs initialIndex={initialIndex}>
            {[0, 1, 2].map((i) => (
              <Column key={i} rows={cols[i]} votes={votes} />
            )) as [React.ReactNode, React.ReactNode, React.ReactNode]}
          </ColumnTabs>
        </main>

        <NoticiasRail />
      </div>
    </>
  );
}
