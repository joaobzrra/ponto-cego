import Link from "next/link";
import { BAND_LABEL, BAND_TONE, BiasBar } from "@/components/bias";
import { DebateBadge } from "@/components/debate-badge";
import { WarningBadge } from "@/components/warning-badge";
import type { tables } from "@/db";
import type { Band } from "@/db/schema";
import { agreePct, MIN_VOTES_TO_SHOW, type VoteAggregate } from "@/lib/feedback-display";

export type ArticleRow = {
  article: typeof tables.articles.$inferSelect;
  outletName: string;
  outletSlug: string;
  /** outlets.warning_label — red provenance badge, left of the bias bar. */
  outletWarning?: string | null;
};

export function relTime(d: Date | null): string {
  if (!d) return "";
  const mins = Math.max(1, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} d`;
}

/**
 * Article row (wireframe grammar): telemetry line on top (outlet · age),
 * headline, keyword chips, band bar at the bottom. `thumb` opts into the
 * square thumbnail — the front page shows it on the first 3 rows per column
 * only, everything below runs text-only.
 */
export function ArticleCard({
  row,
  votes,
  thumb = false,
}: {
  row: ArticleRow;
  votes?: VoteAggregate;
  thumb?: boolean;
}) {
  const a = row.article;
  const keywords = (Array.isArray(a.keywords) ? (a.keywords as string[]) : []).slice(0, 3);
  return (
    <article className="pc-row">
      {thumb && a.thumbnailPath && (
        <Link href={`/a/${a.id}`} className="pc-row-thumb" aria-hidden tabIndex={-1}>
          <img src={`/thumbs/${a.thumbnailPath.replace(/\\/g, "/")}`} alt="" />
        </Link>
      )}
      <div className="pc-row-body">
        <div className="pc-row-meta">
          <span className="pc-row-outlet">{row.outletName}</span>
          <span className="pc-when">{relTime(a.publishedAt ?? a.fetchedAt)} ↗</span>
        </div>
        <Link href={`/a/${a.id}`} className="pc-row-link">
          <h3 className="pc-row-title">{a.title}</h3>
        </Link>
        {keywords.length > 0 && (
          <div className="pc-row-kws">
            {keywords.map((kw) => (
              <Link key={kw} href={`/t/${encodeURIComponent(kw.toLowerCase())}`} className="pc-kw-chip">
                {kw.toLowerCase()}
              </Link>
            ))}
          </div>
        )}
        <div className="pc-row-bias">
          <BiasBar band={a.band} />
          <WarningBadge label={row.outletWarning} />
          <DebateBadge band={a.band} confidence={a.bandConfidence} />
          {a.band && a.band !== "NC" && (
            <>
              {votes && votes.total >= MIN_VOTES_TO_SHOW && (
                <span className="pc-row-votes">
                  {agreePct(votes)}% concordam ({votes.total})
                </span>
              )}
              <span
                className="pc-row-band"
                title={a.band}
                style={{ color: BAND_TONE[a.band as Exclude<Band, "NC">] }}
              >
                {BAND_LABEL[a.band]}
              </span>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
