import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/patrono/obrigado",
  title: "Patrono",
  description: "Retorno da doação via Mercado Pago.",
  noindex: true,
});

/**
 * Return page after the Mercado Pago Checkout Pro redirect (spec
 * 2026-09-02-patrono-checkout-pro-design.md). `status` is the only query
 * param we read and it is never echoed back verbatim — only mapped to one
 * of three fixed copy blocks.
 */
export default async function PatronoObrigadoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;

  if (status === "approved") {
    return (
      <main className="pc-prose">
        <h1>Obrigado.</h1>
        <p>
          Sua doação foi confirmada. O comprovante vem diretamente do Mercado
          Pago, por e-mail.
        </p>
      </main>
    );
  }

  if (status === "pending" || status === "in_process") {
    return (
      <main className="pc-prose">
        <h1>Quase lá.</h1>
        <p>
          PIX e boleto podem levar alguns minutos para confirmar. Pode fechar
          esta aba — a confirmação chega por e-mail do Mercado Pago.
        </p>
      </main>
    );
  }

  return (
    <main className="pc-prose">
      <h1>Não deu certo.</h1>
      <p>
        O pagamento não foi concluído. Você pode <a href="/patrono">tentar de novo</a>{" "}
        ou usar o{" "}
        <a
          href={process.env.NEXT_PUBLIC_MP_DIRECT_LINK ?? "/patrono"}
          rel="noopener"
        >
          link direto do Mercado Pago
        </a>
        .
      </p>
    </main>
  );
}
