import type { SubjectReport } from "@/lib/subject-analysis";

/*
 * "O que isso quer dizer" — the plain-language reading of a subject report.
 *
 * Deterministic templates, no LLM: every sentence is generated from numbers
 * already on screen, so the panel can be audited line by line. Two rules that
 * must survive future edits:
 *   1. Never claim more than the data supports (a blindspot is low INTENSITY,
 *      not absence — the thin side's outlets usually did publish).
 *   2. Never invent timing ("vai cruzar em X dias"): we flag the pattern, and
 *      only a measured base rate could justify a horizon.
 */

const nf = (n: number) => n.toLocaleString("pt-BR");
const pct = (share: number, digits = 0) =>
  `${(share * 100).toFixed(digits).replace(".", ",")}%`;

const ddmm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/** Average reach weight per article — the readable half of "exposição". */
function porte(avg: number): string {
  if (avg >= 100) return "grande porte";
  if (avg >= 40) return "médio porte";
  return "pequeno porte";
}

function scaleSentence(r: SubjectReport): string {
  const base = `Nos últimos ${r.days} dias, “${r.subject}” apareceu em ${nf(r.totals.volume)} ${
    r.totals.volume === 1 ? "artigo" : "artigos"
  } de ${r.totals.outlets} ${r.totals.outlets === 1 ? "veículo" : "veículos"}`;
  if (!r.benchmark) return `${base}.`;
  // Never print "mais que 100%": at the very top the honest phrasing is a
  // top-slice, not a percentile that rounds to certainty.
  if (r.benchmark.percentile >= 0.99) {
    return `${base} — está entre o 1% de assuntos mais cobertos do período.`;
  }
  if (r.benchmark.percentile >= 0.5) {
    return `${base} — mais coberto que ${pct(r.benchmark.percentile)} dos assuntos que acompanhamos no período.`;
  }
  return `${base} — abaixo da mediana dos assuntos que acompanhamos (${nf(r.benchmark.median)} artigos).`;
}

function momentumSentence(r: SubjectReport): string {
  const d = r.totals.deltaPct;
  const peak = r.trend.peakDay ? ddmm(r.trend.peakDay) : null;
  if (d === null) {
    return `Não há período anterior para comparar — o assunto é novo no corpus.`;
  }
  if (d >= 15) {
    const grew = `O volume cresceu ${d}% em relação aos ${r.days} dias anteriores`;
    if (r.trend.direction === "caindo") {
      return `${grew}, mas já vem caindo${peak ? ` desde ${peak}` : ""}: o pico passou.`;
    }
    if (r.trend.direction === "subindo") return `${grew} e continua subindo.`;
    return `${grew} e agora está estável.`;
  }
  if (d <= -15) {
    return `O volume caiu ${Math.abs(d)}% em relação aos ${r.days} dias anteriores.`;
  }
  return `O volume está estável em relação aos ${r.days} dias anteriores.`;
}

function spectrumSentence(r: SubjectReport): string {
  if (!r.blindspot) return "A cobertura está distribuída entre esquerda, centro e direita.";
  const side = r.blindspot.side;
  const outlets = r.spectrum.outlets[side];
  const core =
    `Um lado quase não cobriu: a ${side} publicou ${pct(r.blindspot.share, 1)} dos artigos classificados. ` +
    `Os veículos existem — ${outlets} ${outlets === 1 ? "publicou" : "publicaram"} —, mas com intensidade muito menor.`;
  if (!r.crossoverRisk) return core;
  return `${core} Como o volume ainda sobe, é o padrão de um assunto que tende a cruzar o espectro.`;
}

function exposureSentence(r: SubjectReport): string | null {
  if (!r.exposure || r.totals.volume === 0) return null;
  const avg = r.exposure.value / r.totals.volume;
  return `Em média, cada artigo saiu em um veículo de ${porte(avg)} (peso médio ${avg.toFixed(0)}).`;
}

function rivalSentence(r: SubjectReport): string | null {
  const rival = r.rivalReports[0];
  if (!rival || rival.volume === 0) return null;
  const mine = r.self.volume;
  const ratio =
    mine >= rival.volume
      ? `${(mine / rival.volume).toFixed(1).replace(".", ",")}× o volume`
      : `${pct(mine / rival.volume)} do volume`;
  const heads =
    `${pct(r.self.headlineRate)} dos artigos de “${r.subject}” trazem o termo no título, ` +
    `contra ${pct(rival.headlineRate)} de “${rival.subject}”`;
  return `Comparado a “${rival.subject}”, o assunto teve ${ratio} (${nf(mine)} vs ${nf(rival.volume)}); ${heads}.`;
}

export function SubjectReadout({ report }: { report: SubjectReport }) {
  const sentences = [
    scaleSentence(report),
    momentumSentence(report),
    spectrumSentence(report),
    exposureSentence(report),
    rivalSentence(report),
  ].filter((s): s is string => s !== null);

  return (
    <div className="card">
      <h2>O que isso quer dizer</h2>
      <p style={{ margin: 0, lineHeight: 1.6 }}>{sentences.join(" ")}</p>
      <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.75rem" }}>
        Leitura gerada a partir dos números desta página por regras fixas — sem modelo de
        linguagem, sem interpretação editorial. O percentil compara a palavra-chave do
        classificador com a distribuição de todos os assuntos do período.
      </p>
    </div>
  );
}
