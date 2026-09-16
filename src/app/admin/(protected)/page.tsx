import { count, desc, eq, gt, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireSection } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  await requireSection("overview");
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [[outletCount], [articleCount], [articles24h], recentAudit] = await Promise.all([
    db.select({ n: count() }).from(tables.outlets).where(eq(tables.outlets.enabled, true)),
    db.select({ n: count() }).from(tables.articles),
    db.select({ n: count() }).from(tables.articles).where(gt(tables.articles.fetchedAt, dayAgo)),
    db
      .select({
        action: tables.auditLog.action,
        targetType: tables.auditLog.targetType,
        targetId: tables.auditLog.targetId,
        createdAt: tables.auditLog.createdAt,
        email: sql<string | null>`${tables.adminUsers.email}`,
      })
      .from(tables.auditLog)
      .leftJoin(tables.adminUsers, eq(tables.adminUsers.id, tables.auditLog.adminId))
      .orderBy(desc(tables.auditLog.id))
      .limit(15),
  ]);

  return (
    <>
      <div className="stat-row">
        <div className="card stat">
          <div className="n">{outletCount.n}</div>
          <div className="muted">veículos ativos</div>
        </div>
        <div className="card stat">
          <div className="n">{articleCount.n}</div>
          <div className="muted">artigos ingeridos</div>
        </div>
        <div className="card stat">
          <div className="n">{articles24h.n}</div>
          <div className="muted">últimas 24h</div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Audit log recente</h2>
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Admin</th>
              <th>Ação</th>
              <th>Alvo</th>
            </tr>
          </thead>
          <tbody>
            {recentAudit.map((a, i) => (
              <tr key={i}>
                <td className="mono muted">{a.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>{a.email ?? "sistema"}</td>
                <td className="mono">{a.action}</td>
                <td className="muted">
                  {a.targetType ? `${a.targetType}#${a.targetId}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
