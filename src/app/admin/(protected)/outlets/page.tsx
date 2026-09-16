import Link from "next/link";
import { db, tables } from "@/db";
import { requireSection } from "@/lib/auth";
import { DistributionBar } from "@/components/bias";
import { ncRates7d, outletAggregate } from "@/lib/classification";
import { createOutlet, toggleOutlet } from "./actions";
import { OutletForm } from "./outlet-form";

export const dynamic = "force-dynamic";

export default async function OutletsPage() {
  await requireSection("outlets");
  const [outlets, allFeeds, ncRates] = await Promise.all([
    db.select().from(tables.outlets).orderBy(tables.outlets.name),
    db.select().from(tables.feeds).orderBy(tables.feeds.id),
    ncRates7d(),
  ]);
  const aggregates = new Map(
    await Promise.all(
      outlets.map(async (o) => [o.id, await outletAggregate(o.id)] as const),
    ),
  );
  const feedsByOutlet = new Map<number, typeof allFeeds>();
  for (const f of allFeeds) {
    const list = feedsByOutlet.get(f.outletId) ?? [];
    list.push(f);
    feedsByOutlet.set(f.outletId, list);
  }

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Veículos ({outlets.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Feeds</th>
              <th>Intervalo</th>
              <th>Classificação (90d)</th>
              <th>% NC (7d)</th>
              <th>Dono</th>
              <th>Compliance</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {outlets.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/admin/outlets/${o.id}`}>{o.name}</Link>
                  <div className="muted mono" style={{ fontSize: "0.75rem" }}>
                    {o.slug}
                  </div>
                </td>
                <td className="mono" style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>
                  {(feedsByOutlet.get(o.id) ?? []).map((f) => (
                    <div key={f.id} style={f.enabled ? undefined : { opacity: 0.45 }}>
                      <span className={`badge ${f.scope === "politica" ? "ok" : ""}`}>
                        {f.scope}
                      </span>{" "}
                      {f.url}
                      {!f.enabled && <span className="muted"> (off)</span>}
                    </div>
                  ))}
                </td>
                <td>{o.fetchIntervalMinutes} min</td>
                <td>
                  {(() => {
                    const agg = aggregates.get(o.id);
                    if (!agg) return <span className="muted">sem dados</span>;
                    return (
                      <DistributionBar
                        counts={{
                          esquerda:
                            (agg.bandCounts.E3 ?? 0) + (agg.bandCounts.E2 ?? 0) + (agg.bandCounts.E1 ?? 0),
                          centro: agg.bandCounts.C ?? 0,
                          direita:
                            (agg.bandCounts.D1 ?? 0) + (agg.bandCounts.D2 ?? 0) + (agg.bandCounts.D3 ?? 0),
                        }}
                        politicalArticles={agg.politicalArticles}
                        ncArticles={agg.ncArticles}
                      />
                    );
                  })()}
                </td>
                <td className="mono">
                  {(() => {
                    const r = ncRates.get(o.id);
                    if (!r || r.classified === 0) return <span className="muted">—</span>;
                    const rate = (r.nc / r.classified) * 100;
                    // geral firehose running 60–70% NC is expected; a política
                    // feed running high NC signals mis-set rubric or wrong URL.
                    return `${rate.toFixed(0)}%`;
                  })()}
                </td>
                <td>
                  {o.owner ? (
                    <>
                      <span className={`badge ${o.ownerVerified ? "ok" : "warn"}`}>
                        {o.ownerVerified ? "verificado" : "a revisar"}
                      </span>
                      <div className="muted" style={{ fontSize: "0.72rem", maxWidth: 180 }}>
                        {o.owner}
                      </div>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${o.complianceStatus === "approved" ? "ok" : o.complianceStatus === "restricted" ? "err" : "warn"}`}
                  >
                    {o.complianceStatus}
                  </span>
                </td>
                <td>
                  <span className={`badge ${o.enabled ? "ok" : ""}`}>
                    {o.enabled ? "ativo" : "inativo"}
                  </span>
                </td>
                <td>
                  <form action={toggleOutlet}>
                    <input type="hidden" name="id" value={o.id} />
                    <button className="ghost">{o.enabled ? "Desativar" : "Ativar"}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Adicionar veículo</h2>
        <OutletForm action={createOutlet} submitLabel="Adicionar" />
      </div>
    </>
  );
}
