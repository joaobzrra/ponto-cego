import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireSection } from "@/lib/auth";
import { clusterAggregate } from "@/lib/classification";
import { DistributionBar } from "@/components/bias";
import { mergeClusters, removeFromCluster, renameCluster, reviewDestaque } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Cluster merge/split backstop (spec §3.4.5) + Destaque approval queue
 * (spec §2). Empty states are the norm until stage 5 is enabled
 * (EMBED_ENABLED) — see OPUS-HANDOFF.md.
 */
export default async function ClustersPage() {
  await requireSection("clusters");

  const clusters = await db
    .select({
      id: tables.clusters.id,
      title: tables.clusters.title,
      createdAt: tables.clusters.createdAt,
      // clusters.id must be spelled out: interpolating the Drizzle column
      // rendered an unqualified "id" that Postgres resolved to a.id INSIDE
      // the subquery — members was always 0 and the order-by tied on zeros,
      // showing 40 arbitrary singletons (user-caught 2026-07-14).
      members: sql<number>`(select count(*) from articles a where a.cluster_id = clusters.id and a.status = 'published' and a.duplicate_of is null)`,
    })
    .from(tables.clusters)
    .where(
      and(
        eq(tables.clusters.status, "active"),
        gte(tables.clusters.createdAt, new Date(Date.now() - 72 * 60 * 60 * 1000)),
      ),
    )
    .orderBy(desc(sql`4`))
    .limit(40);

  const aggs = new Map(
    await Promise.all(clusters.map(async (c) => [c.id, await clusterAggregate(c.id)] as const)),
  );

  const memberRows =
    clusters.length > 0
      ? await db
          .select({
            id: tables.articles.id,
            title: tables.articles.title,
            clusterId: tables.articles.clusterId,
            outlet: tables.outlets.name,
            band: tables.articles.band,
          })
          .from(tables.articles)
          .innerJoin(tables.outlets, eq(tables.outlets.id, tables.articles.outletId))
          .where(
            and(
              sql`${tables.articles.clusterId} in (${sql.join(
                clusters.map((c) => sql`${c.id}`),
                sql`, `,
              )})`,
              eq(tables.articles.status, "published"),
              isNull(tables.articles.duplicateOf),
            ),
          )
      : [];
  const membersByCluster = new Map<number, typeof memberRows>();
  for (const m of memberRows) {
    if (m.clusterId == null) continue;
    const list = membersByCluster.get(m.clusterId) ?? [];
    list.push(m);
    membersByCluster.set(m.clusterId, list);
  }

  const drafts = await db
    .select()
    .from(tables.destaqueDrafts)
    .where(eq(tables.destaqueDrafts.status, "draft"))
    .orderBy(desc(tables.destaqueDrafts.createdAt))
    .limit(5);

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Destaque do Dia — rascunhos</h2>
        {drafts.length === 0 && (
          <p className="muted">
            Sem rascunhos. A geração é ativada por SYNTHESIS_ENABLED (etapa 7) — nada
            aparece no site sem aprovação aqui.
          </p>
        )}
        {drafts.map((d) => (
          <div key={d.id} style={{ borderTop: "1px solid var(--border)", padding: "0.7rem 0" }}>
            <strong>{d.draftTitle}</strong>
            <p className="muted" style={{ margin: "0.3rem 0" }}>
              {d.draftSynthesis}
            </p>
            <div className="muted mono" style={{ fontSize: "0.72rem", marginBottom: "0.4rem" }}>
              cluster #{d.clusterId} · {d.sourceCount} fontes · {d.modelId ?? "?"}
            </div>
            <form action={reviewDestaque} style={{ display: "inline-block", marginRight: 8 }}>
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="decision" value="approved" />
              <button>Aprovar e publicar</button>
            </form>
            <form action={reviewDestaque} style={{ display: "inline-block" }}>
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="decision" value="rejected" />
              <button className="ghost">Rejeitar</button>
            </form>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Clusters (72h) — {clusters.length}</h2>
        {clusters.length === 0 && (
          <p className="muted">
            Sem clusters ainda — a etapa 5 liga com EMBED_ENABLED=1 (ver OPUS-HANDOFF.md).
          </p>
        )}
        {clusters.map((c) => {
          const agg = aggs.get(c.id)!;
          const members = membersByCluster.get(c.id) ?? [];
          // agg.totalOutlets counts only politically-banded outlets (blindspot
          // math) — an NC-only cluster would read "0 veículos". The board
          // shows real distinct outlets, with the banded count alongside.
          const outletCount = new Set(members.map((m) => m.outlet)).size;
          return (
            <details key={c.id} style={{ borderTop: "1px solid var(--border)", padding: "0.5rem 0" }}>
              <summary style={{ cursor: "pointer" }}>
                <strong>#{c.id}</strong> {c.title}{" "}
                <span className="muted">
                  ({Number(c.members)} artigos, {outletCount} veículos
                  {agg.totalOutlets > 0 && agg.totalOutlets !== outletCount
                    ? `, ${agg.totalOutlets} com viés`
                    : ""}
                  )
                </span>
              </summary>
              <div style={{ padding: "0.5rem 0 0 1rem" }}>
                <DistributionBar
                  counts={{
                    esquerda:
                      (agg.bandCounts.E3 ?? 0) + (agg.bandCounts.E2 ?? 0) + (agg.bandCounts.E1 ?? 0),
                    centro: agg.bandCounts.C ?? 0,
                    direita:
                      (agg.bandCounts.D1 ?? 0) + (agg.bandCounts.D2 ?? 0) + (agg.bandCounts.D3 ?? 0),
                  }}
                  politicalArticles={agg.politicalArticles}
                  ncArticles={0}
                />
                <ul style={{ margin: "0.5rem 0", paddingLeft: "1rem" }}>
                  {members.map((m) => (
                    <li key={m.id} style={{ marginBottom: 4 }}>
                      [{m.outlet}
                      {m.band ? `, ${m.band}` : ""}] {m.title}{" "}
                      <form action={removeFromCluster} style={{ display: "inline" }}>
                        <input type="hidden" name="articleId" value={m.id} />
                        <button className="ghost" style={{ fontSize: "0.72rem" }}>
                          separar
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
                <form action={renameCluster} style={{ display: "inline-block", marginRight: 12 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <input name="title" defaultValue={c.title} style={{ width: 260 }} />
                  <button className="ghost">Renomear</button>
                </form>
                <form action={mergeClusters} style={{ display: "inline-block" }}>
                  <input type="hidden" name="from" value={c.id} />
                  <input name="into" placeholder="fundir no cluster #" style={{ width: 140 }} />
                  <button className="ghost">Fundir</button>
                </form>
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
