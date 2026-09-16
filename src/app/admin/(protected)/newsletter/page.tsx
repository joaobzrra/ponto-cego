import { sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireSection } from "@/lib/auth";
import { listIssues } from "@/lib/newsletter";
import { composeToday, resendIssue, testSend } from "./actions";

export const dynamic = "force-dynamic";

function fmt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16).replace("T", " ") : "—";
}

export default async function NewsletterPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string | string[] }>;
}) {
  await requireSection("newsletter");
  const sp = await searchParams;
  const msg = Array.isArray(sp.msg) ? sp.msg[0] : sp.msg;

  const [counts, issues] = await Promise.all([
    db
      .select({ status: tables.newsletterSubscribers.status, count: sql<number>`count(*)::int` })
      .from(tables.newsletterSubscribers)
      .groupBy(tables.newsletterSubscribers.status),
    listIssues(60),
  ]);
  const countFor = (status: string) => counts.find((c) => c.status === status)?.count ?? 0;

  return (
    <>
      {msg && (
        <div className="card">
          <p style={{ margin: 0 }}>{msg}</p>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Assinantes</h2>
        <p className="mono">
          {countFor("pending")} pendentes · {countFor("confirmed")} confirmados ·{" "}
          {countFor("unsubscribed")} descadastrados
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Ações</h2>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
          <form action={composeToday}>
            <button className="ghost">Compor hoje</button>
          </form>
          <form action={testSend} style={{ display: "flex", gap: "0.5rem" }}>
            <input type="email" name="email" placeholder="voce@exemplo.com" required />
            <button className="ghost">Testar</button>
          </form>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Edições</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Status</th>
                <th>Destinatários</th>
                <th>Enviado em</th>
                <th>Erro</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => {
                const canResend =
                  (i.status === "failed" || i.status === "composed" || i.status === "preview") &&
                  !i.providerRef;
                return (
                  <tr key={i.date}>
                    <td className="mono">{i.date}</td>
                    <td>
                      <span
                        className={`badge ${i.status === "sent" ? "ok" : i.status === "failed" ? "err" : ""}`}
                      >
                        {i.status}
                      </span>
                    </td>
                    <td className="mono">{i.recipients ?? "—"}</td>
                    <td className="mono muted" style={{ fontSize: "0.75rem" }}>
                      {fmt(i.sentAt)}
                    </td>
                    <td className="muted" style={{ fontSize: "0.75rem", maxWidth: 320 }}>
                      {i.error ? i.error.slice(0, 120) : "—"}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        <a href={`/newsletter/${i.date}`} target="_blank" rel="noreferrer noopener">
                          ver
                        </a>
                        {canResend && (
                          <form action={resendIssue}>
                            <input type="hidden" name="date" value={i.date} />
                            <button className="ghost" style={{ fontSize: "0.7rem" }}>
                              reenviar
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {issues.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Nenhuma edição ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
