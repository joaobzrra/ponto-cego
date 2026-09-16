import type { Blindspot } from "./blindspots";

/*
 * The ONE consumption order for blindspot clusters (spec §3, amended by the
 * whole-branch review 2026-09-03). `subnoticiados()` runs once per home
 * render; this walk decides who gets which cluster. Pure — no DB, no I/O — so
 * the rule is testable without a database.
 *
 * TWO lists, ONE used-id set.
 *   `ranked`    = the one-per-subject list. The rail (featured + weekly) and
 *                 the centre side pair read from it, because those are the
 *                 surfaces where three Moraes cards in a row would read as a
 *                 broken site (ledger CLM-blindspot-week-min-age-one-per-subject).
 *   `rankedAll` = the same ranking WITHOUT the subject filter. The topic
 *                 sections read from it: a section titled MORAES whose cards
 *                 may not be about Moraes starves, and it was starving — the
 *                 subject filter had already thrown away everything that
 *                 matched the keyword.
 * Both are drawn against the caller's `used` set, so a cluster still appears
 * at most once on the page.
 *
 * Why the topic cards are RETURNED but NOT claimed:
 *   a topic section only renders if `keywordLead()` finds a lead cluster for
 *   it, and that lookup is async and depends on `used`. If this function
 *   claimed the cards up front, a keyword that turns out to have no lead would
 *   take three clusters off the page and show none of them — silently
 *   disappearing. So `byKeyword` is a proposal: the caller claims a keyword's
 *   cards into `used` only once it knows the section will render. Clusters
 *   proposed to a keyword that is then dropped stay unclaimed and remain
 *   available to everything downstream (the category sections).
 *   Cross-keyword exclusivity is still decided here, in keyword order, via a
 *   local reservation set, so two rendered sections can never show the same
 *   cluster whatever the caller accepts.
 */
export type Consumed = {
  featured: Blindspot | null;
  weekly: Blindspot[];
  pair: { direita: Blindspot | null; esquerda: Blindspot | null };
  /** Proposed cards per lowercased keyword; keywords with none are absent. */
  byKeyword: Map<string, Blindspot[]>;
};

export function consumeBlindspots(
  ranked: Blindspot[],
  rankedAll: Blindspot[],
  keywords: string[],
  used: Set<number>,
  opts: { weekly?: number; perKeyword?: number } = {},
): Consumed {
  const weeklyLimit = opts.weekly ?? 4;
  const perKeyword = opts.perKeyword ?? 3;

  const take = (pred: (b: Blindspot) => boolean = () => true): Blindspot | null => {
    const b = ranked.find((x) => !used.has(x.clusterId) && pred(x));
    if (b) used.add(b.clusterId);
    return b ?? null;
  };

  const featured = take();
  const weekly: Blindspot[] = [];
  for (let i = 0; i < weeklyLimit; i++) {
    const b = take();
    if (!b) break;
    weekly.push(b);
  }
  const pair = {
    direita: take((b) => b.weakSide === "direita"),
    esquerda: take((b) => b.weakSide === "esquerda"),
  };

  const byKeyword = new Map<string, Blindspot[]>();
  const reserved = new Set<number>();
  for (const raw of keywords) {
    const kw = raw.toLowerCase();
    if (byKeyword.has(kw)) continue;
    const cards: Blindspot[] = [];
    for (const b of rankedAll) {
      if (cards.length >= perKeyword) break;
      if (used.has(b.clusterId) || reserved.has(b.clusterId)) continue;
      if (!b.keywords.includes(kw)) continue;
      cards.push(b);
    }
    if (cards.length === 0) continue;
    for (const b of cards) reserved.add(b.clusterId);
    byKeyword.set(kw, cards);
  }

  return { featured, weekly, pair, byKeyword };
}
