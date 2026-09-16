import { SignupForm } from "@/app/(public)/newsletter/signup-form";

/**
 * RELATÓRIO DE PONTOS CEGOS box (ledger CLM-newsletter-box-waits-for-signup —
 * this is the session that brings the signup, so the box replaces the third
 * blindspot card under each topic pair).
 */
export function NewsletterBox() {
  return (
    <aside className="pc-nl-box" aria-label="Boletim diário">
      <p className="pc-kicker">Ponto cego</p>
      <p className="pc-nl-box-line">Receba o resumo do dia no seu e-mail, todo dia às 7h.</p>
      <SignupForm source="home-box" compact />
    </aside>
  );
}
