import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db, tables } from "@/db";
import { BAND_LABEL } from "@/components/bias";
import type { Band } from "@/db/schema";
import { previewAllowed } from "@/lib/preview";
import { pageMeta } from "@/lib/seo";
import { ArticleGateCard } from "../gate-card";

export const dynamic = "force-dynamic";

/**
 * Gate cards are PERMANENTLY noindex (user decision 2026-07-14): thousands of
 * thin near-duplicate interstitials would read as doorway pages. Real titles
 * and OG tags stay in — shares on WhatsApp/X must preview properly even
 * though search engines skip the page.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const articleId = Number(id);
  if (!Number.isInteger(articleId)) return { robots: { index: false, follow: true } };
  const [row] = await db
    .select({
      title: tables.articles.title,
      band: tables.articles.band,
      status: tables.articles.status,
      outletName: tables.outlets.name,
    })
    .from(tables.articles)
    .innerJoin(tables.outlets, eq(tables.outlets.id, tables.articles.outletId))
    .where(eq(tables.articles.id, articleId))
    .limit(1);
  if (!row || row.status !== "published") return { robots: { index: false, follow: true } };
  const bandLabel = row.band ? (BAND_LABEL[row.band as Band] ?? row.band) : "em análise";
  return pageMeta({
    path: `/a/${articleId}`,
    title: row.title,
    description: `Classificação de viés: ${bandLabel} · ${row.outletName}`,
    noindex: true,
  });
}

/**
 * Full-page pre-redirect gate — reached by direct/shared links. Front-page
 * clicks render the same card as a modal via the intercepted route
 * (@modal/(.)a/[id]).
 */
export default async function ArticleGatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await previewAllowed())) notFound();
  const { id } = await params;
  const articleId = Number(id);
  if (!Number.isInteger(articleId)) notFound();

  return (
    <main className="pc-interstitial">
      <ArticleGateCard articleId={articleId} />
      <p style={{ textAlign: "center", marginTop: "0.75rem" }}>
        <a href="/" style={{ color: "var(--text-faint)", fontSize: "var(--fs-body)" }}>
          ← voltar para o Ponto Cego
        </a>
      </p>
    </main>
  );
}
