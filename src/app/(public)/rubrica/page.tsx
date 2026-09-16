import { BAND_LABEL, BAND_TONE } from "@/components/bias";
import { SpectrumRuler } from "@/components/spectrum-ruler";
import type { Band } from "@/db/schema";
import { getActiveRubric } from "@/lib/rubric";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = pageMeta({
  path: "/rubrica",
  title: "A rubrica",
  description:
    "As regras exatas, publicadas na íntegra e versionadas, que o modelo aplica para classificar o viés de cada artigo — de E3 a D3.",
});

/*
 * A rubrica — its own page (Final-Wireframe 2026-07-18; it lived inside
 * /sobre before). Radical transparency: this is the EXACT text the model
 * receives, versioned, human-owned. The spectrum ruler + band legend give a
 * reader the map before the rules.
 */
export default async function RubricaPage() {
  const rubric = await getActiveRubric();

  return (
    <main className="pc-prose">
      <h1>A rubrica{rubric ? ` (v${rubric.version}, ativa)` : ""}</h1>
      <p>
        Este é o texto exato que o modelo de IA recebe para classificar cada
        artigo. Publicá-lo é deliberado: as regras são nossas, humanas e
        auditáveis — o modelo é uma ferramenta que as aplica. Cada
        classificação registra a versão da rubrica usada.
      </p>

      <h2>O espectro</h2>
      <SpectrumRuler />
      {(Object.keys(BAND_TONE) as Array<Exclude<Band, "NC">>).map((b) => (
        <div key={b} className="pc-band-row">
          <span className="pc-band-chip" style={{ background: BAND_TONE[b] }}>
            {b}
          </span>
          {BAND_LABEL[b]}
        </div>
      ))}
      <p style={{ marginTop: "0.8rem" }}>
        <strong>NC (não classificável)</strong> marca artigos que não são sobre
        política — sem faixa, fora de todas as médias.
      </p>

      <h2>O texto, na íntegra</h2>
      {rubric ? (
        <pre className="pc-rubric">{rubric.content}</pre>
      ) : (
        <p>Rubrica em publicação.</p>
      )}
    </main>
  );
}
