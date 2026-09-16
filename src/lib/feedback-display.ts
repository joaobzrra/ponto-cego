/**
 * Reader-agreement display rule (spec §9): aggregate percentages only appear
 * once an article has enough votes that one person can't read as consensus —
 * also blunts brigading optics. Shared by the gate card and front-page cards.
 */
export const MIN_VOTES_TO_SHOW = 3;

export type VoteAggregate = { agree: number; total: number };

export function agreePct(v: VoteAggregate): number {
  return v.total > 0 ? Math.round((v.agree / v.total) * 100) : 0;
}
