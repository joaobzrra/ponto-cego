import { Footer } from "./footer";
import { MainNav } from "./main-nav";
import { RevealObserver } from "./reveal";
import { SiteHeader } from "./site-header";
import "../public.css";

/*
 * Public shell (Final-Wireframe, 2026-07-18): every reader-facing page shares
 * this chrome — spectrum strip, centered-logo header, faded menu, footer —
 * via the route group, so pages render only their content. Admin lives
 * outside the group with its own layout/CSS. The @modal slot moved into the
 * group with a/[id] so the gate-card interception keeps matching.
 */
export default function PublicLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <div className="pc-shell">
      {/* WCAG 2.4.1: keyboard users can jump past the repeated chrome */}
      <a className="pc-skip" href="#conteudo">
        Pular para o conteúdo
      </a>
      <div className="pc-strip" aria-hidden>
        <span style={{ background: "var(--vies-esquerda)" }} />
        <span style={{ background: "var(--vies-centro)" }} />
        <span style={{ background: "var(--vies-direita)" }} />
      </div>
      <SiteHeader />
      <MainNav />
      <div id="conteudo">{children}</div>
      {modal}
      <Footer />
      <RevealObserver />
    </div>
  );
}
