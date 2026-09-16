import { BRAND } from "@/lib/brand";

/**
 * Uninvited view (no preview cookie) — mirrors the public landing page at
 * pontocego.app: logo, motto, spectrum line, brief, launch banner. The only
 * addition is the invite hint, because reaching this page means someone
 * shared the host without the ?convite= code.
 */
export function LockedPage() {
  return (
    <main className="pc-locked">
      <img
        className="pc-locked-logo"
        src="/brand/pontocego-logo.png"
        alt={BRAND.wordmark}
      />
      <p className="pc-locked-motto">
        {BRAND.motto[0]} {BRAND.motto[1]}
      </p>
      <div className="pc-locked-spectrum" aria-hidden>
        <span style={{ background: "var(--vies-esquerda)" }} />
        <span style={{ background: "var(--vies-centro)" }} />
        <span style={{ background: "var(--vies-direita)" }} />
      </div>
      <p className="pc-locked-brief">
        Um agregador de notícias brasileiro que mostra, lado a lado,{" "}
        <strong>como cada parte do espectro cobre o mesmo fato</strong>. O viés é
        estimado por artigo, sob regras publicadas na íntegra — nunca por decreto,
        nunca veredictos. Você lê a fonte original; nós mostramos o contexto.
      </p>
      <p className="pc-locked-launch">Lançamento em setembro de 2026</p>
      <p className="pc-locked-invite">
        prévia privada de calibração — peça o link de convite
      </p>
      <footer className="pc-locked-contact">
        <a href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a>
      </footer>
    </main>
  );
}
