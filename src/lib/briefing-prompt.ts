/*
 * Resumo do dia prompt (spec §2a). One factual sentence, ≤160 chars, pt-BR,
 * no adjectives, no framing, no attribution of motives. Input is the cluster
 * title plus up to 5 member headlines with their RSS excerpts — full article
 * text is never persisted, so this is all the model ever sees.
 */
export const BRIEFING_SYSTEM = [
  "Você escreve UMA frase factual em português do Brasil que resume um evento noticioso.",
  "Regras: no máximo 160 caracteres; sem adjetivos, sem opinião, sem enquadramento, sem atribuir intenções;",
  "use só o que está nas manchetes e resumos fornecidos; não invente números, nomes ou datas;",
  "não comece com 'O evento' nem repita a manchete principal palavra por palavra.",
  'Responda SOMENTE com JSON no formato {"linha": "..."}.',
].join(" ");

export function briefingPrompt(input: {
  title: string;
  members: Array<{ title: string; excerpt: string | null }>;
}): { system: string; user: string } {
  const lines = input.members
    .slice(0, 5)
    .map((m, i) => `${i + 1}. ${m.title}${m.excerpt ? ` — ${m.excerpt.slice(0, 280)}` : ""}`);
  const user = [`Evento: ${input.title}`, "", "Manchetes e resumos publicados:", ...lines].join("\n");
  return { system: BRIEFING_SYSTEM, user };
}
