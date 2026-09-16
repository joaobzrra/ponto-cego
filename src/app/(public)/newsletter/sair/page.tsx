import { pageMeta } from "@/lib/seo";
import { leave } from "../actions";

export const metadata = pageMeta({
  path: "/newsletter/sair",
  title: "Sair da newsletter",
  description: "Cancele sua inscrição no boletim diário do Ponto Cego.",
  noindex: true,
});

export const dynamic = "force-dynamic";

export default async function SairPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[]; done?: string | string[]; erro?: string | string[] }>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const [t, done, erro] = [one(sp.t), one(sp.done), one(sp.erro)];
  const validToken = t && /^[0-9a-f]{64}$/.test(t) ? t : null;
  return (
    <main className="pc-prose">
      <h1>Newsletter</h1>
      {done === "1" ? (
        <p>Você saiu da lista.</p>
      ) : erro === "1" || !validToken ? (
        <p>Link inválido ou expirado.</p>
      ) : (
        <form action={leave}>
          <input type="hidden" name="t" value={validToken} />
          <button type="submit" className="pc-btn">Sair da lista</button>
        </form>
      )}
    </main>
  );
}
