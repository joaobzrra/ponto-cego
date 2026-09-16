import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { isPatronoEnabled } from "@/lib/patrono";
import { DonateForm } from "./donate-form";

/**
 * Live once MERCADOPAGO_ACCESS_TOKEN is set (spec
 * 2026-09-02-patrono-checkout-pro-design.md); otherwise falls back to the
 * pre-existing "em breve" placeholder so the site can deploy before
 * credentials exist. Rendered per request (not at build) so the env var is
 * read from the running process, never frozen into a static page.
 */
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const enabled = isPatronoEnabled();
  return pageMeta({
    path: "/patrono",
    title: "Patrono",
    description: enabled
      ? "Apoie o Ponto Cego com uma doação única via Mercado Pago."
      : "Apoie o Ponto Cego. Em breve.",
    noindex: !enabled,
  });
}

export default function PatronoPage() {
  if (!isPatronoEnabled()) {
    return (
      <main className="pc-prose">
        <h1>Patrono</h1>
        <p>
          <strong>Em breve.</strong> O Ponto Cego não veicula anúncios nem
          aceita pagamentos em troca de favores ou privilégios. O programa de
          Patronos será a forma de mantê-lo assim.
        </p>
        <p>Nada para pagar por enquanto.</p>
      </main>
    );
  }

  return (
    <main className="pc-prose">
      <h1>Patrono</h1>
      <p>
        O Ponto Cego não veicula anúncios nem aceita pagamentos em troca de
        favores ou privilégios. O programa de Patronos é a forma de mantê-lo
        assim.
      </p>
      <p>
        Esta é uma doação única para a fase de testes do projeto. Ela ajuda a
        pagar servidor e classificação, e não dá direito a nada além disso:
        nenhum selo, nenhum acesso especial, nenhuma influência no que o site
        publica.
      </p>
      <DonateForm />
    </main>
  );
}
