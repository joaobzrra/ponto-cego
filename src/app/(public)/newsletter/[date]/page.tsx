import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ClusterMeter } from "@/components/cluster-meter";
import { getIssue } from "@/lib/newsletter";
import { blindspotKicker } from "@/lib/newsletter-render";
import type { Issue, IssueItem } from "@/lib/newsletter-rules";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";

function ddmmyyyy(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

// cache() so generateMetadata and the page component share one DB read per request.
const loadIssue = cache(async (date: string): Promise<Issue | null> => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const row = await getIssue(date);
  // `preview` is an admin dry run of today's issue; it reads like a composed
  // one and is publicly visible (controller ruling 2026-09-04).
  if (!row || (row.status !== "sent" && row.status !== "composed" && row.status !== "preview")) return null;
  return row.payload as unknown as Issue;
});

const GENERIC_DESCRIPTION =
  "Todo dia às 7h: um ponto cego no topo, os mais discutidos no meio, o que passou despercebido embaixo.";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}): Promise<Metadata> {
  const { date } = await params;
  const issue = await loadIssue(date);
  if (!issue) return { robots: { index: false, follow: true } };
  const headline = issue.top?.headline ?? issue.middle[0]?.headline ?? GENERIC_DESCRIPTION;
  return pageMeta({
    path: `/newsletter/${date}`,
    title: `Edição ${ddmmyyyy(date)}`,
    description: headline,
  });
}

function Story({ item, kicker }: { item: IssueItem; kicker?: string }) {
  return (
    <div className="pc-src-card">
      {kicker && <p className="pc-src-body-head">{kicker}</p>}
      <Link href={`/e/${item.clusterId}`} className="pc-src-link">
        <h3 className="pc-src-title">{item.headline}</h3>
      </Link>
      <p className="pc-src-meta">{item.outlet}</p>
      <ClusterMeter sides={item.sides} labels="inside" />
      {item.line && (
        <p className="pc-brief-line">
          <span className="pc-tag">Resumo automático</span>
          <br />
          {item.line}
        </p>
      )}
    </div>
  );
}

export default async function NewsletterIssuePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const issue = await loadIssue(date);
  if (!issue) notFound();

  return (
    <main className="pc-thread">
      <h1 className="pc-thread-title">Ponto Cego · {ddmmyyyy(date)}</h1>

      {issue.top && (
        <section>
          <h2 className="pc-thread-section">Ponto cego do dia</h2>
          <Story item={issue.top} kicker={blindspotKicker(issue.top)} />
        </section>
      )}

      {issue.middle.length > 0 && (
        <section>
          <h2 className="pc-thread-section">Mais discutidos</h2>
          {issue.middle.map((item) => (
            <Story key={item.clusterId} item={item} />
          ))}
        </section>
      )}

      {issue.bottom && (
        <section>
          <h2 className="pc-thread-section">Passou despercebido</h2>
          <Story item={issue.bottom.item} kicker={issue.bottom.category} />
        </section>
      )}

      {issue.second && (
        <section>
          <h2 className="pc-thread-section">Segundo ponto cego</h2>
          <Story item={issue.second} kicker={blindspotKicker(issue.second)} />
        </section>
      )}
    </main>
  );
}
