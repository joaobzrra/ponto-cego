import { desc, inArray, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireSection } from "@/lib/auth";
import { computeAllHealth, type HealthState } from "@/lib/health";

export const dynamic = "force-dynamic";

const STATE_BADGE: Record<HealthState, { cls: string; label: string }> = {
  online: { cls: "ok", label: "● Online" },
  degraded: { cls: "warn", label: "▲ Degradado" },
  offline: { cls: "err", label: "✕ Offline" },
  pending: { cls: "", label: "… Sem dados" },
};

export default async function HealthPage() {
  await requireSection("health");
  const [health, pipelineResult] = await Promise.all([
    computeAllHealth(),
    db.execute(sql`
      select
        count(*) filter (where classify_status = 'pending')::int as classify_pending,
        count(*) filter (where classify_status = 'failed')::int as classify_failed,
        count(*) filter (
          where low_confidence_input
            and fetched_at > now() - interval '7 days'
        )::int as low_confidence_7d,
        count(*) filter (
          where status = 'published'
            and band is not null and band <> 'NC'
            and embedding is null
        )::int as political_unembedded
      from articles
    `),
  ]);
  const pipeline = (pipelineResult.rows[0] ?? {}) as Record<string, unknown>;

  const snapshots = health.length
    ? await db
        .select()
        .from(tables.rawSnapshots)
        .where(
          inArray(
            tables.rawSnapshots.feedId,
            health.map((h) => h.feedId),
          ),
        )
        .orderBy(desc(tables.rawSnapshots.id))
        .limit(300)
    : [];
  const snapsByFeed = new Map<number, typeof snapshots>();
  for (const s of snapshots) {
    if (s.feedId == null) continue;
    const list = snapsByFeed.get(s.feedId) ?? [];
    if (list.length < 5) {
      list.push(s);
      snapsByFeed.set(s.feedId, list);
    }
  }

  const openAlerts = await db
    .select()
    .from(tables.alerts)
    .orderBy(desc(tables.alerts.id))
    .limit(20);

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Pipeline</h2>
        <p className="mono" style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
          <span>Classificação pendente: {Number(pipeline.classify_pending ?? 0)}</span>
          <span>Classificação falhou: {Number(pipeline.classify_failed ?? 0)}</span>
          <span>Baixa confiança (7d): {Number(pipeline.low_confidence_7d ?? 0)}</span>
          <span>Políticos sem embedding: {Number(pipeline.political_unembedded ?? 0)}</span>
        </p>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Saúde dos feeds</h2>
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: 0 }}>
          Baselines são por feed (Addendum 01): um feed política com 8/dia e um geral com
          100/dia não compartilham limiar de Degradado.
        </p>
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Veículo</th>
              <th>Feed</th>
              <th>Estado</th>
              <th>Motivo</th>
              <th>Última coleta OK</th>
              <th>Último parse OK</th>
              <th>6h / 24h</th>
              <th>Baseline/6h</th>
              <th>Snapshots</th>
            </tr>
          </thead>
          <tbody>
            {health.map((h) => (
              <tr key={h.feedId} style={h.enabled ? undefined : { opacity: 0.45 }}>
                <td>
                  {h.name}
                  {!h.enabled && <span className="muted"> (inativo)</span>}
                </td>
                <td>
                  <span className={`badge ${h.scope === "politica" ? "ok" : ""}`}>{h.scope}</span>
                  <div
                    className="muted mono"
                    style={{ fontSize: "0.7rem", maxWidth: 200, wordBreak: "break-all" }}
                  >
                    {h.feedUrl.replace(/^https?:\/\//, "")}
                  </div>
                </td>
                <td>
                  <span className={`badge ${STATE_BADGE[h.state].cls}`}>
                    {STATE_BADGE[h.state].label}
                  </span>
                </td>
                <td className="muted" style={{ maxWidth: 240 }}>
                  {h.reason}
                </td>
                <td className="mono muted" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                  {h.lastSuccessfulFetch?.toISOString().slice(0, 16).replace("T", " ") ?? "nunca"}
                </td>
                <td className="mono muted" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                  {h.lastSuccessfulParse?.toISOString().slice(0, 16).replace("T", " ") ?? "nunca"}
                </td>
                <td className="mono">
                  {h.new6h} / {h.new24h}
                </td>
                <td className="mono muted">{h.baselinePer6h.toFixed(1)}</td>
                <td className="mono" style={{ fontSize: "0.75rem" }}>
                  {(snapsByFeed.get(h.feedId) ?? []).map((s) => (
                    <div key={s.id}>
                      <a href={`/admin/snapshots/${s.id}`} target="_blank">
                        feed {s.fetchedAt.toISOString().slice(5, 16).replace("T", " ")}
                      </a>
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className="muted" style={{ fontSize: "0.8rem" }}>
          Runbook: feed Degradado → abra os snapshots recentes acima e diffe o feed atual
          contra um de antes da falha. A causa quase sempre é mudança de estrutura do lado do
          veículo.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Alertas recentes</h2>
        <table>
          <thead>
            <tr>
              <th>Feed</th>
              <th>Tipo</th>
              <th>Disparado</th>
              <th>Resolvido</th>
              <th>E-mail</th>
            </tr>
          </thead>
          <tbody>
            {openAlerts.map((a) => {
              const feed = health.find((h) => h.feedId === a.feedId);
              const outlet = feed ?? health.find((h) => h.outletId === a.outletId);
              return (
                <tr key={a.id}>
                  <td>
                    {outlet?.name ?? a.outletId}
                    {feed && <span className="muted"> [{feed.scope}]</span>}
                  </td>
                  <td>
                    <span className={`badge ${a.type === "offline" ? "err" : "warn"}`}>{a.type}</span>
                  </td>
                  <td className="mono muted" style={{ fontSize: "0.75rem" }}>
                    {a.triggeredAt.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="mono muted" style={{ fontSize: "0.75rem" }}>
                    {a.resolvedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "aberto"}
                  </td>
                  <td className="muted">{a.emailedAt ? "enviado" : "—"}</td>
                </tr>
              );
            })}
            {openAlerts.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Nenhum alerta registrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
