import { eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { db, tables } from "@/db";
import type { Band } from "@/db/schema";
import { BiasBar } from "@/components/bias";
import { DebateBadge, inDebate } from "@/components/debate-badge";
import { WarningBadge } from "@/components/warning-badge";
import { MIN_VOTES_TO_SHOW } from "@/lib/feedback-display";
import { ContinueLink } from "./continue-link";
import { FeedbackControls } from "./feedback-controls";

const BAND_NAME: Record<Band, string> = {
  E3: "Esquerda forte",
  E2: "Esquerda moderada",
  E1: "Esquerda leve",
  C: "Centro",
  D1: "Direita leve",
  D2: "Direita moderada",
  D3: "Direita forte",
  NC: "Não classificável",
};

/**
 * The pre-redirect gate content (spec §3.3 attribution + §9 feedback prompt),
 * shared by the full page (/a/[id], direct links) and the front-page modal
 * (intercepted route). The reader always continues to the publisher's page.
 */
export async function ArticleGateCard({ articleId }: { articleId: number }) {
  const [row] = await db
    .select({
      article: tables.articles,
      outletName: tables.outlets.name,
      outletWarning: tables.outlets.warningLabel,
    })
    .from(tables.articles)
    .innerJoin(tables.outlets, eq(tables.outlets.id, tables.articles.outletId))
    .where(eq(tables.articles.id, articleId));
  if (!row || row.article.status !== "published") notFound();
  const a = row.article;

  const classifiable = a.band !== null && a.band !== "NC";

  const [votes] = await db
    .select({
      agree: sql<number>`count(*) filter (where ${tables.feedback.direction} = 'agree')`,
      total: sql<number>`count(*)`,
    })
    .from(tables.feedback)
    .where(eq(tables.feedback.articleId, articleId));
  const total = Number(votes.total);
  const agreePct = total > 0 ? Math.round((Number(votes.agree) / total) * 100) : 0;

  const sessionId = (await cookies()).get("pc_sess")?.value;
  const alreadyVoted = sessionId
    ? (
        await db
          .select({ id: tables.feedback.id })
          .from(tables.feedback)
          .where(
            sql`${tables.feedback.articleId} = ${articleId} and ${tables.feedback.sessionId} = ${sessionId}`,
          )
      ).length > 0
    : false;

  return (
    <div className="pc-card" style={{ padding: "1.25rem", margin: 0 }}>
      <div className="pc-card-meta">
        Você está indo para {row.outletName} <WarningBadge label={row.outletWarning} />
      </div>
      <h1 className="pc-card-title" style={{ fontSize: "var(--fs-section)" }}>
        {a.title}
      </h1>

      {classifiable ? (
        <>
          <BiasBar band={a.band} />
          <div className="pc-card-meta">
            Rótulo: {BAND_NAME[a.band!]} ({a.band})
            {total >= MIN_VOTES_TO_SHOW && (
              <> · {agreePct}% dos leitores concordam ({total} votos)</>
            )}{" "}
            <DebateBadge band={a.band} confidence={a.bandConfidence} />
          </div>
          {inDebate(a.band, a.bandConfidence) && (
            <p className="pc-card-meta" style={{ marginTop: "0.35rem", color: "var(--warn)" }}>
              A confiança neste rótulo é baixa — seu voto ajuda a calibrar.
            </p>
          )}
          {alreadyVoted ? (
            <p className="pc-card-meta" style={{ marginTop: "0.75rem" }}>
              Obrigado — seu voto foi registrado e vai para revisão humana.
            </p>
          ) : (
            <FeedbackControls articleId={a.id} />
          )}
        </>
      ) : (
        <p className="pc-card-meta" style={{ marginTop: "0.5rem" }}>
          {a.band === "NC"
            ? "Sem rótulo de viés — este artigo não é sobre política."
            : "Ainda em classificação."}
        </p>
      )}

      {a.classifyReason && (
        <details className="pc-reason">
          <summary>Razão da classificação</summary>
          <p>{a.classifyReason}</p>
        </details>
      )}

      <ContinueLink
        articleId={a.id}
        href={a.canonicalUrl}
        outletName={row.outletName}
        band={a.band}
      />
    </div>
  );
}
