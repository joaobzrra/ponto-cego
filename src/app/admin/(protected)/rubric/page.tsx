import { desc } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireSection } from "@/lib/auth";
import { getActiveRubric } from "@/lib/rubric";
import { requestCalibrationRun } from "./actions";
import { RubricForm } from "./rubric-form";

export const dynamic = "force-dynamic";

function pct(part: number, total: number): string {
  return total === 0 ? "—" : `${((part / total) * 100).toFixed(0)}%`;
}

export default async function RubricPage() {
  await requireSection("rubric");
  const active = await getActiveRubric();
  const [versions, calibrationSet, runs] = await Promise.all([
    db.select().from(tables.rubrics).orderBy(desc(tables.rubrics.version)).limit(10),
    db.select().from(tables.calibrationArticles),
    db.select().from(tables.calibrationRuns).orderBy(desc(tables.calibrationRuns.id)).limit(8),
  ]);

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>
          Rubrica de classificação — ativa: v{active?.version ?? "—"}
        </h2>
        <p className="muted" style={{ fontSize: "0.8rem" }}>
          Versionada, editável sem deploy, com change log (spec §5). Publicar cria uma nova
          versão ativa; cada artigo classificado grava a rubric_version usada. Após editar,
          rode a calibração para medir concordância e drift.
        </p>
        <RubricForm currentContent={active?.content ?? ""} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>
          Calibração ({calibrationSet.length} artigos, {calibrationSet.filter((c) => c.expectedBand === "NC").length} NC)
        </h2>
        <form action={requestCalibrationRun}>
          <button className="ghost" disabled={calibrationSet.length === 0}>
            Rodar conjunto de calibração agora
          </button>
        </form>
        <p className="muted" style={{ fontSize: "0.8rem" }}>
          O worker executa em até 5 min (chamadas diretas, não batch). Rode: antes do launch,
          após cada edição de rubrica, após cada troca de modelo (spec §3.1). Adicione artigos
          ao conjunto pela lista de Artigos.
        </p>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Status</th>
              <th>Rubrica</th>
              <th>Concordância</th>
              <th>NC (separado)</th>
              <th>Fetch falhas</th>
              <th>Quando</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.id}</td>
                <td>
                  <span
                    className={`badge ${r.status === "done" ? "ok" : r.status === "failed" ? "err" : "warn"}`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="mono">v{r.rubricVersion ?? "—"}</td>
                <td className="mono">
                  {r.status === "done" ? `${r.agreed}/${r.total} (${pct(r.agreed, r.total)})` : "—"}
                </td>
                <td className="mono">
                  {r.status === "done" ? `${r.ncAgreed}/${r.ncTotal} (${pct(r.ncAgreed, r.ncTotal)})` : "—"}
                </td>
                <td className="mono">{r.status === "done" ? r.fetchFailed : "—"}</td>
                <td className="mono muted" style={{ fontSize: "0.75rem" }}>
                  {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Nenhuma execução ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Histórico de versões</h2>
        <table>
          <thead>
            <tr>
              <th>Versão</th>
              <th>Nota de mudança</th>
              <th>Publicada</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td className="mono">
                  v{v.version} {v.active && <span className="badge ok">ativa</span>}
                </td>
                <td className="muted" style={{ maxWidth: 480 }}>
                  {v.changeNote}
                </td>
                <td className="mono muted" style={{ fontSize: "0.75rem" }}>
                  {v.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
