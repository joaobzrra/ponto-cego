/**
 * Bootstrap rubric, seeded into the `rubrics` table on first run when the table
 * is empty.
 *
 * PUBLIC EXTRACT: the production bootstrap text is not included in this
 * repository. It is replaced here by a placeholder so the project still builds
 * and type-checks.
 *
 * This is not a loss of transparency. The rubric that actually classifies
 * articles is the *active* row in the `rubrics` table, which is versioned,
 * audited, editable without a deploy, and published in full at
 * https://pontocego.app/rubrica — the exact text the model receives. The seed
 * below only matters for the very first boot of an empty database.
 */

export const DEFAULT_RUBRIC_CONTENT = [
  "# Rubrica (placeholder)",
  "",
  "Substitua este texto pela sua própria rubrica de classificação antes de",
  "classificar qualquer artigo. A rubrica ativa em produção está publicada em",
  "https://pontocego.app/rubrica.",
  "",
  "Uma rubrica precisa definir, no mínimo:",
  "",
  "- as faixas do espectro e o que cada uma significa;",
  "- o que conta como conteúdo não-político (NC);",
  "- como a confiança deve ser reportada;",
  "- o que o modelo deve fazer quando o texto é ambíguo ou insuficiente.",
].join("\n");

export const DEFAULT_RUBRIC_CHANGE_NOTE =
  "Placeholder seed rubric (public extract). Replace before classifying.";
