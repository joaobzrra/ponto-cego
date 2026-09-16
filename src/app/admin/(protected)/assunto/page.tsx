import Link from "next/link";
import { VolumeColumns, type VolumePoint } from "@/components/volume-columns";
import { requireSection } from "@/lib/auth";
import { localDayKey, subjectAnalysis, type SubjectReport } from "@/lib/subject-analysis";
import { SubjectReadout } from "@/components/subject-readout";

export const dynamic = "force-dynamic";

/*
 * Análise de Assunto (.PLANNING/profitability.MD + design review 2026-07-20):
 * deterministic coverage breakdown for a free-text subject. Read-only over the
 * public classification (client-blind by construction), zero LLM calls.
 *
 * Presentation rules from the review: article share is the primary spectrum
 * unit (stated on-screen); outlet counts are reach, never a partition (the
 * side sets overlap); blindspot copy frames intensity, not absence; the
 * crossover card needs the recent daily trend rising, not the w/w delta.
 */

const WINDOWS = [7, 14] as const;

const SIDE_META = [
  { key: "esquerda", label: "esquerda", color: "var(--vies-esquerda)" },
  { key: "centro", label: "centro", color: "var(--vies-centro)" },
  { key: "direita", label: "direita", color: "var(--vies-direita)" },
] as const;

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div style={{ background: "var(--bg-inset)", borderRadius: 2, height: 8, minWidth: 120 }}>
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: "var(--text-faint)",
          borderRadius: 2,
        }}
      />
    </div>
  );
}

/**
 * Side-share partition bar (articles, clicks, …). Local on purpose:
 * ClusterMeter's tooltips and captions speak in "veículos" (distinct-outlet
 * semantics) and would lie here.
 */
function ShareBar({
  articles,
  unit = "artigos",
}: {
  articles: SubjectReport["spectrum"]["articles"];
  unit?: string;
}) {
  const total = articles.esquerda + articles.centro + articles.direita;
  if (total === 0) return <p className="muted">Sem {unit} classificados na janela.</p>;
  const segs = SIDE_META.map((m) => ({ ...m, n: articles[m.key] }));
  return (
    <div>
      <div style={{ display: "flex", gap: 2, marginBottom: "0.3rem" }}>
        {segs.map(
          (s) =>
            s.n > 0 && (
              <span
                key={s.key}
                style={{
                  width: `${(s.n / total) * 100}%`,
                  color: s.color,
                  fontSize: "0.75rem",
                  textAlign: "center",
                  whiteSpace: "nowrap",
                }}
              >
                {pct1(s.n / total)}
              </span>
            ),
        )}
      </div>
      <div
        style={{ display: "flex", gap: 2, height: 10 }}
        role="img"
        aria-label={segs.map((s) => `${s.label}: ${s.n} ${unit}`).join(", ")}
      >
        {segs.map(
          (s) =>
            s.n > 0 && (
              <div
                key={s.key}
                title={`${s.label}: ${s.n} ${unit}`}
                style={{ width: `${(s.n / total) * 100}%`, background: s.color }}
              />
            ),
        )}
      </div>
      <div style={{ display: "flex", gap: "0.8rem", marginTop: "0.28rem", fontSize: "0.75rem" }}>
        {segs.map((s) => (
          <span key={s.key} style={{ color: s.n > 0 ? s.color : "var(--text-faint)" }}>
            {s.n} {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function pct1(share: number): string {
  return `${(share * 100).toFixed(1).replace(".", ",").replace(",0", "")}%`;
}

function ddmm(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** The 2×days series can skip empty days; re-densify so the x-axis is honest. */
function denseDaily(report: SubjectReport): VolumePoint[] {
  const byDay = new Map(report.daily.map((d) => [d.day, d]));
  const points: VolumePoint[] = [];
  const end = new Date();
  for (let i = report.days * 2 - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 24 * 60 * 60 * 1000);
    const key = localDayKey(d);
    const row = byDay.get(key);
    points.push({ day: key, total: row?.total ?? 0, inTitle: row?.inTitle ?? 0 });
  }
  return points;
}

/** "2h", "35min", "1d 4h" — median lag display. */
function fmtLag(min: number): string {
  if (min < 1) return "líder";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 > 0 ? ` ${min % 60}min` : ""}`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export default async function AssuntoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; days?: string; rivals?: string }>;
}) {
  await requireSection("assunto");
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const days = WINDOWS.includes(Number(params.days) as (typeof WINDOWS)[number])
    ? (Number(params.days) as (typeof WINDOWS)[number])
    : 7;
  const rivals = (params.rivals ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)
    .slice(0, 4);

  const report = q ? await subjectAnalysis(q, days, rivals) : null;
  const classified = report
    ? report.spectrum.articles.esquerda +
      report.spectrum.articles.centro +
      report.spectrum.articles.direita
    : 0;

  return (
    <main>
      <h1>Análise de Assunto</h1>
      <div className="card">
        <form method="get" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ flex: "2 1 220px" }}>
            Assunto (pessoa, empresa, tema)
            <input name="q" defaultValue={q} placeholder="ex.: petrobras" required />
          </label>
          <label style={{ flex: "0 1 120px" }}>
            Janela
            <select name="days" defaultValue={String(days)}>
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w} dias
                </option>
              ))}
            </select>
          </label>
          <label style={{ flex: "1 1 220px" }}>
            Rivais (opcional, separados por vírgula)
            <input name="rivals" defaultValue={params.rivals ?? ""} placeholder="ex.: lula, tarifas" />
          </label>
          <button type="submit">Analisar</button>
        </form>
      </div>

      {report && report.totals.volume === 0 && (
        <div className="card">
          <p className="muted">
            Nenhuma cobertura encontrada para “{report.subject}” nos últimos {days} dias
            (palavras-chave e títulos).
          </p>
        </div>
      )}

      {report && report.totals.volume > 0 && (
        <>
          <SubjectReadout report={report} />

          <div className="card">
            <div className="stat-row">
              <div className="stat">
                <div className="n">{report.totals.volume.toLocaleString("pt-BR")}</div>
                <div className="muted">artigos em {days} dias</div>
              </div>
              <div className="stat">
                <div className="n">
                  {report.totals.deltaPct === null
                    ? "—"
                    : `${report.totals.deltaPct > 0 ? "+" : ""}${report.totals.deltaPct}%`}
                </div>
                <div className="muted">
                  vs {days} dias anteriores ({report.totals.priorVolume})
                </div>
              </div>
              <div className="stat">
                <div className="n">{report.trend.direction}</div>
                <div className="muted">
                  tendência (2 dias completos)
                  {report.trend.peakDay ? ` · pico ${ddmm(report.trend.peakDay)}` : ""}
                </div>
              </div>
              <div className="stat">
                <div className="n">{report.totals.outlets}</div>
                <div className="muted">veículos</div>
              </div>
              <div className="stat">
                <div className="n">{report.totals.events}</div>
                <div className="muted">eventos (2+ veículos)</div>
              </div>
              {report.exposure && (
                <div className="stat">
                  <div className="n">
                    {Math.round(report.exposure.value / report.totals.volume).toLocaleString(
                      "pt-BR",
                    )}
                  </div>
                  <div className="muted">
                    peso médio por artigo · total{" "}
                    {Math.round(report.exposure.value).toLocaleString("pt-BR")}
                  </div>
                </div>
              )}
            </div>
            {report.exposure && (
              <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.75rem" }}>
                Exposição = soma dos pesos de alcance dos veículos por artigo. O peso vem de
                dados públicos de tráfego do Google (CrUX) por fórmula fixa e pública: a faixa
                de popularidade no Brasil define a base e a faixa global refina dentro dela.
                É uma estimativa relativa de audiência, não auditoria — as faixas do CrUX são
                largas, então veículos de porte parecido podem empatar; overrides manuais são
                sinalizados por veículo.
              </p>
            )}
            <p className="muted" style={{ margin: "0.75rem 0 0", fontSize: "0.8rem" }}>
              Composição do match: {report.totals.inTitle} com o termo no título ·{" "}
              {report.totals.viaKeyword} via palavra-chave do classificador (busca por
              substring: “{report.subject}” também captura variações no título).
            </p>
          </div>

          {report.crossoverRisk && report.blindspot && (
            <div className="card" style={{ borderColor: "var(--err)" }}>
              <strong>Risco de crossover — ponto cego à {report.blindspot.side}</strong>
              <p className="muted" style={{ margin: "0.3rem 0 0" }}>
                A {report.blindspot.side} está em {pct1(report.blindspot.share)} dos artigos
                classificados e o volume diário segue subindo — padrão de assunto que tende a
                cruzar o espectro. (Sinal de padrão, sem previsão de prazo.)
              </p>
            </div>
          )}

          <div className="card">
            <h2 style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              Espectro — share de artigos
              {report.blindspot ? (
                <span className="badge warn">
                  ponto cego à {report.blindspot.side} — {pct1(report.blindspot.share)}
                </span>
              ) : (
                classified > 0 && <span className="badge">cobertura distribuída no espectro</span>
              )}
            </h2>
            <ShareBar articles={report.spectrum.articles} />
            <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.8rem" }}>
              Viés medido por artigo ({classified} classificados; NC e não classificados fora da
              conta). Alcance por lado — veículos com ao menos um artigo:{" "}
              {report.spectrum.outlets.esquerda} à esquerda, {report.spectrum.outlets.centro} no
              centro, {report.spectrum.outlets.direita} à direita, de {report.totals.outlets} no
              total (conjuntos se sobrepõem; não é uma partição).
            </p>
            {report.blindspot && (
              <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.8rem" }}>
                Leitura: cobertura {report.blindspot.side === "direita" ? "à direita" : "à esquerda"}{" "}
                existe ({report.spectrum.outlets[report.blindspot.side]} veículos), mas com
                intensidade muito menor — {pct1(report.blindspot.share)} dos artigos.
              </p>
            )}
            {classified > 0 && (
              <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.8rem" }}>
                Destaque no título (manchete vs. menção enterrada):{" "}
                {SIDE_META.map((m, i) => {
                  const arts = report.spectrum.articles[m.key];
                  const t = report.spectrum.inTitle[m.key];
                  return (
                    <span key={m.key}>
                      {i > 0 && " · "}
                      <span style={{ color: m.color }}>{m.label}</span>{" "}
                      {arts > 0 ? pct1(t / arts) : "—"}
                    </span>
                  );
                })}
              </p>
            )}
          </div>

          {report.rivalReports.length > 0 && (
            <div className="card">
              <h2>Comparação direta</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Métrica</th>
                      <th>
                        <strong>{report.self.subject}</strong>
                      </th>
                      {report.rivalReports.map((rival) => (
                        <th key={rival.subject}>{rival.subject}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Artigos</td>
                      <td>{report.self.volume.toLocaleString("pt-BR")}</td>
                      {report.rivalReports.map((rival) => (
                        <td key={rival.subject}>
                          {rival.volume.toLocaleString("pt-BR")}
                          {rival.volume > 0 && (
                            <div className="muted" style={{ fontSize: "0.75rem" }}>
                              {/* Read from the rival's own column: this rival's
                                  volume AS A SHARE OF the subject's. */}
                              ({pct1(rival.volume / Math.max(1, report.self.volume))} do volume do
                              assunto)
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td>vs período anterior</td>
                      <td>
                        {report.self.deltaPct === null
                          ? "—"
                          : `${report.self.deltaPct > 0 ? "+" : ""}${report.self.deltaPct}%`}
                      </td>
                      {report.rivalReports.map((rival) => (
                        <td key={rival.subject}>
                          {rival.deltaPct === null
                            ? "—"
                            : `${rival.deltaPct > 0 ? "+" : ""}${rival.deltaPct}%`}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td>Veículos</td>
                      <td>{report.self.outlets}</td>
                      {report.rivalReports.map((rival) => (
                        <td key={rival.subject}>{rival.outlets}</td>
                      ))}
                    </tr>
                    <tr>
                      <td>No título</td>
                      <td>{pct1(report.self.headlineRate)}</td>
                      {report.rivalReports.map((rival) => (
                        <td key={rival.subject}>{pct1(rival.headlineRate)}</td>
                      ))}
                    </tr>
                    <tr>
                      <td>Espectro</td>
                      <td>
                        <ShareBar articles={report.self.articles} />
                      </td>
                      {report.rivalReports.map((rival) => (
                        <td key={rival.subject}>
                          <ShareBar articles={rival.articles} />
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td>Peso médio por artigo</td>
                      <td>
                        {report.self.exposure === null || report.self.volume === 0
                          ? "—"
                          : Math.round(report.self.exposure / report.self.volume)}
                      </td>
                      {report.rivalReports.map((rival) => (
                        <td key={rival.subject}>
                          {rival.exposure === null || rival.volume === 0
                            ? "—"
                            : Math.round(rival.exposure / rival.volume)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.8rem" }}>
                Todas as colunas usam o mesmo matcher (palavra-chave do classificador ou termo no
                título) e a mesma janela de {days} dias, então os números são diretamente
                comparáveis — diferente do “share da conversa” abaixo, que mede co-menção, não
                volume independente. “No título” conta só o termo na manchete; no corpo ou nas
                palavras-chave não entra nessa fatia.
              </p>
            </div>
          )}

          <div className="card">
            <h2>Volume diário</h2>
            <VolumeColumns
              points={denseDaily(report)}
              splitIndex={report.days}
              todayKey={localDayKey(new Date())}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            <div className="card" style={{ marginBottom: 0 }}>
              <h2>Reação dos leitores</h2>
              <div className="stat-row">
                <div className="stat">
                  <div className="n">{report.reaction.searches}</div>
                  <div className="muted">buscas no site</div>
                </div>
                <div className="stat">
                  <div className="n">{report.reaction.clicks}</div>
                  <div className="muted">cliques para veículos</div>
                </div>
                <div className="stat">
                  <div className="n">
                    {report.reaction.feedbackAgree + report.reaction.feedbackDisagree}
                  </div>
                  <div className="muted">
                    votos de rótulo ({report.reaction.feedbackAgree} concordam)
                  </div>
                </div>
              </div>
              {report.reaction.clicks > 0 && (
                <div style={{ marginTop: "0.75rem" }}>
                  <p className="muted" style={{ margin: "0 0 0.3rem", fontSize: "0.8rem" }}>
                    Para qual lado os leitores clicam:
                  </p>
                  <ShareBar articles={report.reaction.clicksBySide} unit="cliques" />
                </div>
              )}
              <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.75rem" }}>
                Analytics próprio e pseudônimo (events), sem terceiros; bots excluídos.
              </p>
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <h2>Quem publica primeiro</h2>
              {report.firstMovers.length === 0 ? (
                <p className="muted">Sem eventos multi-veículo na janela.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Veículo</th>
                      <th style={{ textAlign: "right" }}>Eventos</th>
                      <th style={{ textAlign: "right" }}>1º a publicar</th>
                      <th style={{ textAlign: "right" }}>Atraso mediano</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.firstMovers.map((o) => (
                      <tr key={o.slug}>
                        <td>{o.name}</td>
                        <td style={{ textAlign: "right" }}>{o.events}</td>
                        <td style={{ textAlign: "right" }}>{o.timesFirst}×</td>
                        <td style={{ textAlign: "right" }}>{fmtLag(o.medianLagMin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.75rem" }}>
                Sobre os {report.totals.events} eventos do assunto com 2+ veículos: quem abre a
                pauta e quem segue (atraso vs. o primeiro artigo do evento).
              </p>
            </div>
          </div>

          {report.shareOfVoice.length > 0 && (
            <div className="card">
              <h2>Share da conversa ({days} dias)</h2>
              <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.8rem" }}>
                Dos {report.totals.volume} artigos sobre “{report.subject}”, quantos também
                mencionam cada rival (co-menção, não volume global).
              </p>
              <table>
                <tbody>
                  {report.shareOfVoice.map((r) => (
                    <tr key={r.subject}>
                      <td style={{ width: "30%" }}>{r.subject}</td>
                      <td>
                        <Bar value={r.count} max={report.totals.volume} />
                      </td>
                      <td style={{ width: "8rem", textAlign: "right" }}>
                        {r.count} ({pct1(r.count / report.totals.volume)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div className="card" style={{ marginBottom: 0 }}>
              <h2>Principais eventos</h2>
              <table>
                <tbody>
                  {report.topClusters.map((c) => (
                    <tr key={c.clusterId}>
                      <td>
                        <Link href={`/e/${c.clusterId}`}>{c.title}</Link>
                      </td>
                      <td style={{ width: "4rem", textAlign: "right" }}>{c.arts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <h2>Principais veículos</h2>
              <table>
                <thead>
                  <tr>
                    <th>Veículo</th>
                    <th title="Banda dominante dos últimos 90 dias do veículo (tudo que publica)">
                      Linha editorial
                    </th>
                    <th title="Banda dominante dos artigos DESTE veículo sobre o assunto">
                      Viés no assunto
                    </th>
                    <th style={{ textAlign: "right" }}>Artigos</th>
                    <th
                      style={{ textAlign: "right" }}
                      title="Quanto da produção total do veículo na janela é sobre este assunto"
                    >
                      Dedicação
                    </th>
                    <th
                      style={{ textAlign: "right" }}
                      title="Artigos próprios vs. cópias de agência (dedup) sobre o assunto"
                    >
                      Próprio
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.topOutlets.map((o) => {
                    const dedication = o.windowTotal > 0 ? o.arts / o.windowTotal : null;
                    const own = o.arts + o.wireCopies > 0 ? o.arts / (o.arts + o.wireCopies) : null;
                    return (
                      <tr key={o.slug}>
                        <td>{o.name}</td>
                        <td className="muted">{o.editorialLean ?? "—"}</td>
                        <td className="muted">{o.subjectBand ?? "—"}</td>
                        <td style={{ textAlign: "right" }}>{o.arts}</td>
                        <td style={{ textAlign: "right" }}>
                          {dedication === null ? "—" : pct1(dedication)}
                        </td>
                        <td style={{ textAlign: "right" }}>{own === null ? "—" : pct1(own)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.75rem" }}>
                “Linha editorial” = banda dominante de tudo que o veículo publicou em 90 dias;
                “viés no assunto” = só dos artigos sobre este assunto (podem divergir — viés é
                por artigo). “Dedicação” = fatia da produção total do veículo dedicada ao
                assunto na janela. “Próprio” = artigos originais vs. cópias de agência
                detectadas pelo dedup.
              </p>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
