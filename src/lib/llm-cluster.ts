/**
 * LLM helpers for stage 5/7 — kept beside (not inside) llm.ts so the proven
 * classification client stays untouched. Both features are API-gated and
 * inert until enabled; see OPUS-HANDOFF.md step 4.
 *
 * - Cluster confirm (spec §3.4.4): Haiku yes/no on borderline pairs, batched
 *   through the same Batch API + spend ceiling as classification.
 * - Destaque synthesis (spec §2): Sonnet-tier DRAFT for human approval;
 *   describes the aggregate event only — never one outlet's reporting.
 */
export const SYNTHESIS_MODEL_ID = process.env.SYNTHESIS_MODEL_ID ?? "claude-sonnet-5";

export function clusterConfirmPrompt(
  a: { title: string; excerpt: string; outlet: string },
  b: { title: string; excerpt: string; outlet: string },
): string {
  return [
    "Os dois itens abaixo são notícias brasileiras. Responda APENAS com JSON",
    '{"mesmo_evento": true|false, "confianca": 0..1}.',
    "Eles descrevem o MESMO evento real específico (mesmo fato, mesmos atores,",
    "mesmo momento) — não apenas o mesmo tema?",
    "",
    `A (${a.outlet}): ${a.title}`,
    a.excerpt,
    "",
    `B (${b.outlet}): ${b.title}`,
    b.excerpt,
  ].join("\n");
}

export function parseClusterConfirm(raw: string): { sameEvent: boolean; confidence: number } | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { mesmo_evento?: boolean; confianca?: number };
    if (typeof parsed.mesmo_evento !== "boolean") return null;
    return {
      sameEvent: parsed.mesmo_evento,
      confidence: typeof parsed.confianca === "number" ? parsed.confianca : 0.5,
    };
  } catch {
    return null;
  }
}

/**
 * Synthesis draft prompt. Input is titles+excerpts across the cluster's
 * sources (never full text — spec §3.3); output must describe the aggregate
 * event, neutral register, ≤2 sentences, no outlet names, no adjectives of
 * opinion. The draft is NEVER published without admin approval.
 */
export function synthesisPrompt(
  members: Array<{ title: string; excerpt: string; outlet: string; band: string | null }>,
): string {
  const lines = [
    "Você redige o 'FATO CENTRAL AGREGADO' de um agregador de notícias",
    "politicamente neutro. Abaixo estão manchetes e trechos de VÁRIOS veículos",
    "sobre o mesmo evento. Responda APENAS com JSON",
    '{"titulo": "...", "sintese": "..."}.',
    "Regras: descreva o EVENTO agregado (nunca a cobertura de um veículo);",
    "registro neutro e factual; síntese com no máximo 2 frases; sem opinião,",
    "sem adjetivos valorativos, sem nomes de veículos.",
    "",
  ];
  for (const m of members) {
    lines.push(`- [${m.outlet}${m.band ? `, ${m.band}` : ""}] ${m.title} — ${m.excerpt}`);
  }
  return lines.join("\n");
}

export function parseSynthesis(raw: string): { titulo: string; sintese: string } | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { titulo?: string; sintese?: string };
    if (!parsed.titulo || !parsed.sintese) return null;
    return { titulo: parsed.titulo, sintese: parsed.sintese };
  } catch {
    return null;
  }
}
