import { desc, eq, sql } from "drizzle-orm";
import { isHttpUrl } from "@/lib/http";
import { db, tables } from "@/db";
import { BANDS } from "@/db/schema";
import { requireSection } from "@/lib/auth";
import { setArticleBand } from "../articles/actions";
import { markFeedbackReviewed } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Bias Correction Queue (spec §5/§9): reader feedback lands here for HUMAN
 * review — it never adjusts bands automatically (brigading defense). Band
 * corrections reuse the audited setArticleBand override.
 */
export default async function FeedbackQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ mostrar?: string; ordem?: string }>;
}) {
  await requireSection("feedback");
  const { mostrar, ordem } = await searchParams;
  const showAll = mostrar === "todos";
  const positiveFirst = ordem === "concordam";

  const rows = await db
    .select({
      articleId: tables.feedback.articleId,
      agree: sql<number>`count(*) filter (where ${tables.feedback.direction} = 'agree')`,
      disagree: sql<number>`count(*) filter (where ${tables.feedback.direction} = 'disagree')`,
      unreviewed: sql<number>`count(*) filter (where ${tables.feedback.reviewedAt} is null)`,
      suggestions: sql<string | null>`string_agg(${tables.feedback.suggestedBand}, ' ' order by ${tables.feedback.suggestedBand}) filter (where ${tables.feedback.suggestedBand} is not null)`,
      title: tables.articles.title,
      canonicalUrl: tables.articles.canonicalUrl,
      band: tables.articles.band,
      bandConfidence: tables.articles.bandConfidence,
      classifyReason: tables.articles.classifyReason,
      outletName: tables.outlets.name,
    })
    .from(tables.feedback)
    .innerJoin(tables.articles, eq(tables.articles.id, tables.feedback.articleId))
    .innerJoin(tables.outlets, eq(tables.outlets.id, tables.articles.outletId))
    .groupBy(
      tables.feedback.articleId,
      tables.articles.title,
      tables.articles.canonicalUrl,
      tables.articles.band,
      tables.articles.bandConfidence,
      tables.articles.classifyReason,
      tables.outlets.name,
    )
    .having(
      showAll
        ? undefined
        : sql`count(*) filter (where ${tables.feedback.reviewedAt} is null) > 0`,
    )
    .orderBy(
      desc(
        positiveFirst
          ? sql`count(*) filter (where ${tables.feedback.direction} = 'agree')`
          : sql`count(*) filter (where ${tables.feedback.direction} = 'disagree')`,
      ),
    );

  return (
    <div className="card">
      <h2 style={{ marginTop: 0, fontWeight: 400 }}>Fila de Correção de Viés</h2>
      <p className="muted" style={{ fontSize: "0.8rem" }}>
        Feedback de leitores ("o rótulo está correto?") — sempre revisão humana, nunca
        ajuste automático. Corrigir banda usa o mesmo override auditado da lista de
        Artigos.
      </p>
      <p style={{ fontSize: "0.8rem" }}>
        <a href="/admin/feedback">não revisados</a> ·{" "}
        <a href="/admin/feedback?mostrar=todos">todos</a> ·{" "}
        <a href="/admin/feedback?mostrar=todos&amp;ordem=concordam">bons exemplos</a>
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Artigo</th>
              <th>Banda</th>
              <th>Concordam</th>
              <th>Discordam</th>
              <th>Sugestões</th>
              <th>Corrigir</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.articleId}>
                <td style={{ maxWidth: 380 }}>
                  <a href={isHttpUrl(r.canonicalUrl) ? r.canonicalUrl : "#"} target="_blank" rel="noreferrer noopener">
                    {r.title}
                  </a>
                  <div className="muted" style={{ fontSize: "0.75rem" }}>
                    {r.outletName}
                    {r.classifyReason && <> — {r.classifyReason.slice(0, 140)}</>}
                  </div>
                </td>
                <td>
                  <span
                    className="badge"
                    title={`confiança ${r.bandConfidence?.toFixed(2) ?? "?"}`}
                  >
                    {r.band ?? "—"}
                  </span>
                </td>
                <td className="mono">{r.agree}</td>
                <td className="mono">{r.disagree}</td>
                <td className="mono" style={{ fontSize: "0.75rem" }}>
                  {r.suggestions ?? <span className="muted">—</span>}
                </td>
                <td>
                  <form action={setArticleBand} style={{ display: "flex", gap: "0.25rem" }}>
                    <input type="hidden" name="id" value={r.articleId} />
                    <select name="band" defaultValue={r.band ?? "C"} style={{ fontSize: "0.75rem" }}>
                      {BANDS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    <button className="ghost" style={{ fontSize: "0.7rem" }}>
                      aplicar
                    </button>
                  </form>
                </td>
                <td>
                  {Number(r.unreviewed) > 0 ? (
                    <form action={markFeedbackReviewed}>
                      <input type="hidden" name="articleId" value={r.articleId} />
                      <button className="ghost" style={{ fontSize: "0.7rem" }}>
                        marcar revisado
                      </button>
                    </form>
                  ) : (
                    <span className="badge ok">revisado</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {showAll ? "Nenhum feedback ainda." : "Fila vazia — nada aguardando revisão."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
