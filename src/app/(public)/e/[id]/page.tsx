import { and, eq, isNull, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { db, tables } from "@/db";
import { relTime } from "@/components/article-card";
import { BAND_LABEL } from "@/components/bias";
import { ClusterMeter } from "@/components/cluster-meter";
import { SourceCard, sideCounts, sideOf, type Member } from "@/components/cluster-parts";
import { LockedPage } from "@/components/locked";
import { WarningBadge } from "@/components/warning-badge";
import { outletAggregates } from "@/lib/classification";
import { resolveCluster } from "@/lib/clusters";
import { previewAllowed } from "@/lib/preview";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";

/*
 * Event thread page (user decision 2026-07-16): one
 * cluster, its full cross-spectrum coverage. The lead is the FIRST centro
 * article to publish — first-to-publish as the fair, unbiased anchor —
 * falling back to the earliest article of any side when the centro never
 * covered it (the fallback is labeled, never passed off as centro).
 * noindex while WIP, same as /topicos.
 */

async function clusterMembers(clusterId: number): Promise<Member[]> {
  const rows = await db
    .select({
      id: tables.articles.id,
      title: tables.articles.title,
      band: tables.articles.band,
      at: sql<Date>`coalesce(${tables.articles.publishedAt}, ${tables.articles.fetchedAt})`,
      outletName: tables.outlets.name,
      outletSlug: tables.outlets.slug,
      outletId: tables.articles.outletId,
      outletWarning: tables.outlets.warningLabel,
      owner: tables.outlets.owner,
      ownerType: tables.outlets.ownerType,
      ownerVerified: tables.outlets.ownerVerified,
      ownerSourceUrl: tables.outlets.ownerSourceUrl,
    })
    .from(tables.articles)
    .innerJoin(tables.outlets, eq(tables.outlets.id, tables.articles.outletId))
    .where(
      and(
        eq(tables.articles.clusterId, clusterId),
        eq(tables.articles.status, "published"),
        isNull(tables.articles.duplicateOf),
      ),
    )
    .orderBy(sql`coalesce(${tables.articles.publishedAt}, ${tables.articles.fetchedAt}) asc`);
  return rows.map((r) => ({ ...r, at: new Date(r.at) }));
}

/** First centro piece; earliest overall when centro never covered it. */
function pickLead(members: Member[]): { lead: Member; isCentro: boolean } {
  const centro = members.find((m) => sideOf(m.band) === "centro");
  return centro ? { lead: centro, isCentro: true } : { lead: members[0], isCentro: false };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const clusterId = Number(id);
  if (!Number.isInteger(clusterId)) return { robots: { index: false, follow: true } };
  const members = await clusterMembers(clusterId);
  if (members.length === 0) return { robots: { index: false, follow: true } };
  const { lead } = pickLead(members);
  const outlets = new Set(members.map((m) => m.outletSlug)).size;
  return pageMeta({
    path: `/e/${clusterId}`,
    title: lead.title,
    description: `Como ${outlets} veículos cobriram este evento, em todo o espectro político.`,
    noindex: true,
  });
}

export default async function EventThread({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await previewAllowed())) return <LockedPage />;
  const { id } = await params;
  const clusterId = Number(id);
  if (!Number.isInteger(clusterId)) notFound();

  const members = await clusterMembers(clusterId);
  if (members.length === 0) {
    /*
     * Empty is the merged case: mergeClusters moves the articles to the
     * target and leaves this shell behind. Follow the pointer so links
     * shared before the merge keep working. 308 (not 307) — the move is
     * permanent, and these are public URLs other people have published.
     */
    const canonical = await resolveCluster(clusterId);
    if (canonical !== null && canonical !== clusterId) permanentRedirect(`/e/${canonical}`);
    notFound();
  }

  const { lead, isCentro } = pickLead(members);
  const sides = sideCounts(members);
  const outlets = new Set(members.map((m) => m.outletSlug)).size;
  const newestFirst = [...members].reverse();

  // One 90-day aggregate per distinct outlet in the thread, in ONE grouped
  // query: the SourceCard expands to the outlet's diverging bar with this
  // article's band marked. Same exclusion rules as /veiculos.
  const outletIds = [...new Set(members.map((m) => m.outletId).filter((x): x is number => x != null))];
  const aggs = await outletAggregates(outletIds);

  return (
    <main className="pc-thread">
      <p className="pc-method">
        Fio do evento: a primeira cobertura como âncora, e como cada veículo
        tratou a mesma história.
      </p>
        <div className="pc-cluster-meta">
          <span>
            {outlets} veículos · {members.length} artigo{members.length === 1 ? "" : "s"}
          </span>
          <span className="pc-when">atualizado {relTime(newestFirst[0].at)}</span>
        </div>

        <div className="pc-thread-eyebrow">
          {isCentro ? "primeira cobertura · centro" : "primeira cobertura"}
        </div>
        <Link href={`/a/${lead.id}`} className="pc-cluster-link">
          <h1 className="pc-thread-title">{lead.title}</h1>
        </Link>
        <div className="pc-thread-lead-meta">
          {lead.outletName} <WarningBadge label={lead.outletWarning} />
          {lead.band && lead.band !== "NC" && <> · {BAND_LABEL[lead.band]}</>} ·{" "}
          <span className="pc-when">{relTime(lead.at)}</span>
        </div>

        <ClusterMeter sides={sides} />

        <section className="pc-thread-list">
          <h2 className="pc-thread-section">Toda a cobertura</h2>
          {newestFirst.map((m) => (
            <SourceCard key={m.id} m={m} agg={m.outletId != null ? aggs.get(m.outletId) : undefined} />
          ))}
        </section>

      <p style={{ marginTop: "1.4rem" }}>
        <Link href="/" style={{ color: "var(--text-faint)", fontSize: "var(--fs-body)" }}>
          ← voltar para o início
        </Link>
      </p>
    </main>
  );
}
