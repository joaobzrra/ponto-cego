import { confirmSubscriber } from "@/lib/newsletter";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  path: "/newsletter/confirmar",
  title: "Confirmar inscrição",
  description: "Confirme sua inscrição no boletim diário do Ponto Cego.",
  noindex: true,
});

export const dynamic = "force-dynamic";

export default async function ConfirmarPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const sp = await searchParams;
  const t = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const ok = t && /^[0-9a-f]{64}$/.test(t) ? await confirmSubscriber(t) : false;
  return (
    <main className="pc-prose">
      <h1>Newsletter</h1>
      <p>
        {ok
          ? "Inscrição confirmada. A primeira edição chega às 7h."
          : "Link inválido ou expirado."}
      </p>
    </main>
  );
}
