import Link from "next/link";
import { pageMeta } from "@/lib/seo";
import { listIssues } from "@/lib/newsletter";
import { SignupForm } from "./signup-form";

export const metadata = pageMeta({
  path: "/newsletter",
  title: "Newsletter",
  description: "Todo dia às 7h: um ponto cego no topo, os mais discutidos no meio, o que passou despercebido embaixo.",
});

export const dynamic = "force-dynamic";

function ddmmyyyy(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

export default async function NewsletterPage() {
  const issues = (await listIssues(30)).filter((row) => row.status === "sent" || row.status === "composed" || row.status === "preview");
  return (
    <main className="pc-prose">
      <h1>Newsletter</h1>
      <p className="pc-method">Cadastre-se no nosso newsletter e receba nossos destaques do dia.</p>
      <SignupForm source="newsletter-page" />

      <h2 className="pc-thread-section">Edições</h2>
      {issues.length === 0 ? (
        <p className="pc-side-note">Nenhuma edição ainda. A primeira sai no próximo dia útil às 7h.</p>
      ) : (
        <ul className="pc-nl-issues">
          {issues.map((row) => {
            const payload = row.payload as { top?: { headline?: string }; middle?: Array<{ headline?: string }> };
            const headline = payload.top?.headline ?? payload.middle?.[0]?.headline;
            return (
              <li key={row.date}>
                <Link href={`/newsletter/${row.date}`}>
                  <time dateTime={row.date}>{ddmmyyyy(row.date)}</time>
                  {headline}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
