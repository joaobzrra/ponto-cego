/**
 * Single source of truth for brand copy (name, tagline, method line).
 * The possible rename (Ponto Cego → Prisma) is pending a user decision —
 * when it lands, this file is the only place that changes. Internal names
 * (DB, slugs, package.json, logs) deliberately stay "ponto-cego".
 */
export const BRAND = {
  /** Display name, used in the masthead and <title>. */
  name: "Ponto Cego",
  /** Uppercase wordmark as rendered in the masthead. */
  wordmark: "PONTO CEGO",
  /** One-line positioning, used in metadata description. */
  tagline:
    "Agregador de notícias politicamente neutro para o cenário midiático brasileiro.",
  /** Masthead motto (wireframe): two short lines beside the wordmark. */
  motto: ["A verdade não tem viés,", "só contexto."],
  /**
   * The methodology line shown in the public header — scientific posture:
   * estimates under a published rubric, never editorial verdicts.
   */
  methodLine:
    "Viés estimado por artigo (nunca por veículo) sob rubrica editorial publicada, com revisão humana. Todo clique leva à página original do veículo.",
  /** Public contact for corrections/takedown (spec §3.3, day-one requirement). */
  contactEmail: "contato@pontocego.app",
} as const;
