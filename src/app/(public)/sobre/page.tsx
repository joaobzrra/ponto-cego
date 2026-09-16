import Link from "next/link";
import { BAND_LABEL, BAND_TONE } from "@/components/bias";
import { SpectrumRuler } from "@/components/spectrum-ruler";
import type { Band } from "@/db/schema";
import { BRAND } from "@/lib/brand";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = pageMeta({
  path: "/sobre",
  title: "Sobre e metodologia",
  description:
    "Como o Ponto Cego funciona: a rubrica editorial publicada, o espectro E3–D3, o papel da revisão humana e por que classificamos artigos, nunca veículos.",
});

// Legend chips use the shared intensity tones (leve = lighter tint).
const BAND_COLORS = BAND_TONE;

/**
 * Sobre — who we are and how we operate. Radical transparency is the
 * product's defense: the rules are published, versioned, and human-owned;
 * the model only applies them. The full rubric moved to its own page
 * (/rubrica, Final-Wireframe 2026-07-18) so this one stays readable.
 */
export default async function SobrePage() {
  return (
    <main className="pc-prose">
        <h1>Sobre o {BRAND.name}</h1>
        <p>
          O {BRAND.name} é um agregador de notícias brasileiro construído em torno
          de uma única pergunta: <strong>de onde vem o que você lê?</strong> Não
          escrevemos notícias, não hospedamos conteúdo e não emitimos veredictos.
          Cada artigo leva, em um clique, à página original do veículo. O que
          adicionamos é medição: uma estimativa de viés por artigo, feita sob regras
          publicadas — esta página inclui as regras na íntegra.
        </p>

        <h2>As faixas</h2>
        <p>
          Artigos políticos recebem uma de 7 faixas, de E3 a D3. Faixas são
          estimativas estáveis e auditáveis; não exibimos números de falsa precisão.
        </p>
        <SpectrumRuler />
        {(Object.keys(BAND_COLORS) as Array<Exclude<Band, "NC">>).map((b) => (
          <div key={b} className="pc-band-row">
            <span className="pc-band-chip" style={{ background: BAND_COLORS[b] }}>
              {b}
            </span>
            {BAND_LABEL[b]}
          </div>
        ))}
        <p style={{ marginTop: "0.8rem" }}>
          <strong>NC (não classificável)</strong> marca artigos que não são sobre
          política — sem faixa, fora de todas as médias.
        </p>

        <h2 id="calibracao">Como operamos — sistema em calibração</h2>
        <p>
          Os rótulos são estimativas automatizadas em fase de calibração. Eles
          podem mudar quando a rubrica, o conjunto de validação humana ou o
          modelo forem aprimorados.
        </p>
        <ul>
          <li>
            O texto completo de cada artigo é lido de forma <strong>transitória</strong>{" "}
            por um modelo de IA — nunca armazenado, indexado
            ou exibido por nós. Guardamos só título, trecho curto, miniatura em
            preto e branco e o link original.
          </li>
          <li>
            O modelo aplica a <strong>rubrica abaixo</strong>, escrita e mantida por
            humanos, versionada, com registro de mudanças. Cada classificação grava
            a versão usada e um grau de confiança, exibido junto ao rótulo.
          </li>
          <li>
            Rótulos podem ser corrigidos por revisão humana (com log de auditoria), e
            o botão <strong>Discordo</strong> em cada artigo alimenta uma fila de
            revisão — votos nunca alteram rótulos automaticamente.
          </li>
          <li>
            A posição de um <strong>veículo</strong> é somente a média móvel de 90
            dias das faixas dos seus artigos — nunca um decreto editorial. Veja{" "}
            <Link href="/veiculos">veículos</Link>, incluindo a propriedade de cada
            um (fatos registrais com fonte).
          </li>
        </ul>

        <h2>A rubrica</h2>
        <p>
          As regras exatas que o modelo recebe para classificar cada artigo são
          públicas, na íntegra e versionadas, em página própria:{" "}
          <Link href="/rubrica">a rubrica completa</Link>. Publicá-la é
          deliberado: as regras são nossas e auditáveis — o modelo é uma
          ferramenta que as aplica.
        </p>

        <h2>Correções e remoção</h2>
        <p>
          Veículos e leitores podem pedir correção ou remoção de qualquer item:{" "}
          <a href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a>. Pedidos
          de remoção são atendidos de imediato e o tempo de resposta fica registrado.
          Práticas de dados: <Link href="/privacidade">privacidade</Link>.
        </p>

        <p className="pc-powered">
          <span className="pc-powered-spark" aria-hidden>
            ✳
          </span>{" "}
          Powered by Claude Fable 5 — a engenharia deste site foi construída em
          parceria com a IA da Anthropic.
        </p>
    </main>
  );
}
