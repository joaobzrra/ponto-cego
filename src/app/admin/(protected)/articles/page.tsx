import { and, desc, eq, isNull, type SQL } from "drizzle-orm";
import { isHttpUrl } from "@/lib/http";
import { db, tables } from "@/db";
import { BANDS, type Band } from "@/db/schema";
import { BiasBar } from "@/components/bias";
import { requireSection } from "@/lib/auth";
import { addToCalibration, setArticleBand, setArticleScope, setArticleStatus } from "./actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ outlet?: string; status?: string; scope?: string; band?: string }>;
}) {
  await requireSection("articles");
  const {
    outlet: outletFilter,
    status: statusFilter,
    scope: scopeFilter,
    band: bandFilter,
  } = await searchParams;

  const outlets = await db.select().from(tables.outlets).orderBy(tables.outlets.name);

  const conditions: SQL[] = [];
  if (outletFilter) conditions.push(eq(tables.articles.outletId, Number(outletFilter)));
  if (statusFilter) conditions.push(eq(tables.articles.status, statusFilter));
  if (scopeFilter) conditions.push(eq(tables.articles.feedScope, scopeFilter as "politica" | "geral"));
  if (bandFilter === "unclassified") conditions.push(isNull(tables.articles.band));
  else if (bandFilter && BANDS.includes(bandFilter as Band))
    conditions.push(eq(tables.articles.band, bandFilter as Band));

  const rows = await db
    .select({
      article: tables.articles,
      outletName: tables.outlets.name,
    })
    .from(tables.articles)
    .innerJoin(tables.outlets, eq(tables.outlets.id, tables.articles.outletId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(tables.articles.id))
    .limit(PAGE_SIZE);

  return (
    <div className="card">
      <h2 style={{ marginTop: 0, fontWeight: 400 }}>Artigos</h2>

      <form method="get" style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <select name="outlet" defaultValue={outletFilter ?? ""}>
          <option value="">todos os veículos</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={statusFilter ?? ""}>
          <option value="">qualquer status</option>
          <option value="published">publicado</option>
          <option value="unpublished">despublicado</option>
        </select>
        <select name="scope" defaultValue={scopeFilter ?? ""}>
          <option value="">qualquer escopo</option>
          <option value="politica">política</option>
          <option value="geral">geral</option>
        </select>
        <select name="band" defaultValue={bandFilter ?? ""}>
          <option value="">qualquer banda</option>
          {BANDS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
          <option value="unclassified">não classificado</option>
        </select>
        <button className="ghost">Filtrar</button>
      </form>

      <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Título / excerto</th>
            <th>Veículo</th>
            <th>Banda</th>
            <th>Publicado</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ article: a, outletName }) => (
            <tr key={a.id}>
              <td>
                {a.thumbnailPath ? (
                  <img
                    className="thumb"
                    src={`/thumbs/${a.thumbnailPath.replace(/\\/g, "/")}`}
                    alt=""
                  />
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td style={{ maxWidth: 420 }}>
                <a href={isHttpUrl(a.canonicalUrl) ? a.canonicalUrl : "#"} target="_blank" rel="noreferrer noopener">
                  {a.title}
                </a>
                <div className="muted" style={{ fontSize: "0.8rem" }}>
                  {a.excerpt}
                </div>
              </td>
              <td>
                {outletName}
                <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                  <span
                    className={`badge ${a.feedScope === "politica" ? "ok" : ""}`}
                    style={{ fontSize: "0.65rem" }}
                  >
                    {a.feedScope}
                  </span>
                  <form action={setArticleScope}>
                    <input type="hidden" name="id" value={a.id} />
                    <input
                      type="hidden"
                      name="scope"
                      value={a.feedScope === "politica" ? "geral" : "politica"}
                    />
                    <button
                      className="ghost"
                      style={{ fontSize: "0.65rem", padding: "0.05rem 0.4rem" }}
                      title="Corrigir escopo manualmente (auditado)"
                    >
                      → {a.feedScope === "politica" ? "geral" : "política"}
                    </button>
                  </form>
                </div>
              </td>
              <td>
                {a.band ? (
                  <>
                    <span className="badge" title={a.classifyReason ?? ""}>
                      {a.band}
                    </span>{" "}
                    {a.bandConfidence != null && (
                      <span className="muted" style={{ fontSize: "0.7rem" }}>
                        {Math.round(a.bandConfidence * 100)}%
                      </span>
                    )}
                    <BiasBar band={a.band} />
                  </>
                ) : (
                  <span className="muted" style={{ fontSize: "0.75rem" }}>
                    {a.classifyStatus === "queued" ? "na fila…" : a.classifyStatus === "failed" ? "falhou" : "—"}
                  </span>
                )}
                <form
                  action={setArticleBand}
                  style={{ display: "flex", gap: "0.25rem", marginTop: "0.25rem" }}
                >
                  <input type="hidden" name="id" value={a.id} />
                  <select name="band" defaultValue={a.band ?? "C"} style={{ fontSize: "0.7rem", padding: "0.1rem" }}>
                    {BANDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  <button
                    className="ghost"
                    style={{ fontSize: "0.65rem", padding: "0.05rem 0.4rem" }}
                    title="Correção manual de banda, incl. NC↔banda (auditada)"
                  >
                    corrigir
                  </button>
                </form>
                {a.band && (
                  <form action={addToCalibration} style={{ marginTop: "0.2rem" }}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="expectedBand" value={a.band} />
                    <button
                      className="ghost"
                      style={{ fontSize: "0.65rem", padding: "0.05rem 0.4rem" }}
                      title="Adiciona ao conjunto de calibração com a banda atual como esperada (corrija a banda antes, se preciso)"
                    >
                      → calibração
                    </button>
                  </form>
                )}
              </td>
              <td className="mono muted" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                {a.publishedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "—"}
              </td>
              <td>
                <span className={`badge ${a.status === "published" ? "ok" : "err"}`}>
                  {a.status === "published" ? "publicado" : "despublicado"}
                </span>
              </td>
              <td>
                <form action={setArticleStatus}>
                  <input type="hidden" name="id" value={a.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={a.status === "published" ? "unpublished" : "published"}
                  />
                  <button className={a.status === "published" ? "danger" : "ghost"}>
                    {a.status === "published" ? "Despublicar" : "Republicar"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {rows.length === PAGE_SIZE && (
        <p className="muted">Mostrando os {PAGE_SIZE} mais recentes.</p>
      )}
    </div>
  );
}
