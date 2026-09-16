/*
 * Pure email renderers (spec 2026-09-04 §6). Table layout, light palette
 * literals, one brand image (the wordmark, owner ruling 2026-09-04), no
 * scripts, no tracking pixel. Everything from the issue is
 * escaped here — the issue holds raw strings.
 */
import type { Issue, IssueItem, IssueSides } from "@/lib/newsletter-rules";

export type RenderOpts = { siteUrl: string; unsubscribeUrl: string; viewUrl: string };

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const C = {
  bg: "#f9f8f6", text: "#1a1b1b", dim: "#55524c", faint: "#6f6a61", rule: "#d9cfc7",
  esq: "#00722e", cen: "#5c5c5b", dir: "#012169",
};
const FONT = "font-family:'Bricolage Grotesque','Segoe UI',Helvetica,Arial,sans-serif;";
const LABEL = `${FONT}font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${C.faint};`;

function ddmm(date: string): string {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

/** Owner ruling 2026-09-04: fixed subject, no per-issue variation. */
export function subjectFor(issue: Issue): string {
  return `PONTO CEGO | RESUMO DO DIA ${ddmm(issue.date)}`;
}

export function sidesLine(s: IssueSides): string {
  return `${s.esquerda} esquerda · ${s.centro} centro · ${s.direita} direita`;
}

/**
 * Floored percentages (min 4% for any non-zero side) can sum above 100 —
 * e.g. {1,1,100}/102 floors to 4/4/98 = 106. When that happens the excess is
 * taken from the largest raw segment so the row always sums to exactly 100
 * and no non-zero side drops below the 4% floor (review finding #1).
 */
function barWidths(s: IssueSides): [number, number, number] {
  const total = s.esquerda + s.centro + s.direita;
  if (total === 0) return [0, 0, 0];
  const raw = [s.esquerda, s.centro, s.direita];
  const pct = raw.map((n) => (n === 0 ? 0 : Math.max(4, Math.round((n / total) * 100)))) as [number, number, number];
  const sum = pct[0] + pct[1] + pct[2];
  if (sum > 100) {
    const excess = sum - 100;
    let largest = 0;
    for (let i = 1; i < 3; i++) if (raw[i] > raw[largest]) largest = i;
    pct[largest] = Math.max(4, pct[largest] - excess);
  }
  return pct;
}

function bar(s: IssueSides): string {
  const total = s.esquerda + s.centro + s.direita;
  if (total === 0) return "";
  const [we, wc, wd] = barWidths(s);
  const cell = (n: number, width: number, color: string) =>
    n === 0 ? "" : `<td width="${width}%" height="8" bgcolor="${color}" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="2" border="0" style="margin:8px 0 4px;"><tr>${cell(s.esquerda, we, C.esq)}${cell(s.centro, wc, C.cen)}${cell(s.direita, wd, C.dir)}</tr></table>`;
}

function storyHtml(it: IssueItem, kicker?: string): string {
  const line = it.line
    ? `<p style="${FONT}margin:6px 0 0;font-size:14px;line-height:1.5;color:${C.dim};"><span style="${LABEL}font-size:10px;">RESUMO AUTOMÁTICO</span><br>${escapeHtml(it.line)}</p>`
    : "";
  const k = kicker ? `<p style="${LABEL}margin:0 0 4px;">${escapeHtml(kicker)}</p>` : "";
  return `<tr><td style="padding:14px 0;border-bottom:1px solid ${C.rule};">
    ${k}
    <a href="${escapeHtml(it.url)}" style="${FONT}font-size:18px;font-weight:700;line-height:1.3;color:${C.text};text-decoration:none;">${escapeHtml(it.headline)}</a>
    <p style="${FONT}margin:4px 0 0;font-size:12px;color:${C.faint};">${escapeHtml(it.outlet)}</p>
    ${bar(it.sides)}
    <p style="${LABEL}margin:0;">${sidesLine(it.sides)}</p>
    ${line}
  </td></tr>`;
}

function sectionHtml(label: string, rows: string): string {
  return `<tr><td style="padding:22px 0 0;"><p style="${LABEL}margin:0;font-weight:700;color:${C.text};">${label}</p></td></tr>${rows}`;
}

/**
 * The blindspot kicker string ("0% direita" / "só 12% esquerda"). Exported so
 * the archive page at /newsletter/<date> renders the SAME string the email
 * does — defined once, here. (components/home/blindspot-cards.tsx keeps its
 * own copy on purpose: it is the home page's wording, not the issue's.)
 */
export function blindspotKicker(it: IssueItem): string | undefined {
  if (!it.weakSide) return undefined;
  const pct = Math.round((it.weakShare ?? 0) * 100);
  return pct === 0 ? `0% ${it.weakSide}` : `só ${pct}% ${it.weakSide}`;
}

export function renderIssueHtml(issue: Issue, opts: RenderOpts): string {
  const parts: string[] = [];
  if (issue.top) parts.push(sectionHtml("PONTO CEGO DO DIA", storyHtml(issue.top, blindspotKicker(issue.top))));
  if (issue.middle.length > 0) parts.push(sectionHtml("MAIS DISCUTIDOS", issue.middle.map((m) => storyHtml(m)).join("")));
  if (issue.bottom) parts.push(sectionHtml("PASSOU DESPERCEBIDO", storyHtml(issue.bottom.item, issue.bottom.category)));
  if (issue.second) parts.push(sectionHtml("SEGUNDO PONTO CEGO", storyHtml(issue.second, blindspotKicker(issue.second))));
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subjectFor(issue))}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
<tr><td align="center" style="padding:0 0 12px;border-bottom:2px solid ${C.text};">
  <a href="${escapeHtml(opts.siteUrl)}" style="${FONT}font-size:22px;letter-spacing:.18em;color:${C.text};text-decoration:none;"><img src="${escapeHtml(opts.siteUrl)}/brand/pontocego-logo.png" width="260" alt="PONTO CEGO" style="display:block;width:260px;max-width:100%;height:auto;border:0;margin:0 auto;"></a>
  <p style="${FONT}font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.text};margin:12px 0 0;line-height:1.6;">Resumo do dia ${escapeHtml(ddmm(issue.date))} - Viés sugestivo, não um veredito<br>Questione, classifique diretamente pelo <a href="${escapeHtml(opts.siteUrl)}" style="color:${C.text};">pontocego.app</a></p>
  <p style="${LABEL}margin:4px 0 0;"><a href="${escapeHtml(opts.viewUrl)}" style="color:${C.faint};">ver no site</a></p>
</td></tr>
${parts.join("")}
<tr><td style="padding:24px 0 0;">
  <p style="${FONT}font-size:12px;line-height:1.5;color:${C.faint};margin:0;">Você recebe isto porque confirmou em pontocego.app. Cada barra mostra quantos veículos de esquerda, centro e direita cobriram o evento nas últimas horas.<br>
  <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:${C.faint};">Sair da lista</a> · <a href="${escapeHtml(opts.viewUrl)}" style="color:${C.faint};">Ver no site</a> · <a href="${escapeHtml(opts.siteUrl)}/privacidade" style="color:${C.faint};">Privacidade</a></p>
</td></tr>
</table></td></tr></table></body></html>`;
}

export function renderIssueText(issue: Issue, opts: RenderOpts): string {
  const out: string[] = [`PONTO CEGO · ${ddmm(issue.date)}`, ""];
  const story = (it: IssueItem, kicker?: string) => {
    if (kicker) out.push(kicker.toUpperCase());
    out.push(it.headline, `${it.outlet} · ${sidesLine(it.sides)}`);
    if (it.line) out.push(`resumo automático: ${it.line}`);
    out.push(it.url, "");
  };
  if (issue.top) { out.push("PONTO CEGO DO DIA"); story(issue.top, blindspotKicker(issue.top)); }
  if (issue.middle.length) { out.push("MAIS DISCUTIDOS"); issue.middle.forEach((m) => story(m)); }
  if (issue.bottom) { out.push("PASSOU DESPERCEBIDO"); story(issue.bottom.item, issue.bottom.category); }
  if (issue.second) { out.push("SEGUNDO PONTO CEGO"); story(issue.second, blindspotKicker(issue.second)); }
  out.push(`Ver no site: ${opts.viewUrl}`, `Sair da lista: ${opts.unsubscribeUrl}`);
  return out.join("\n");
}
