/**
 * Server-side excerpt hard cap (spec §3.3): ~20 words maximum, applied in code
 * regardless of how much text the feed provides. This is the legal-safety
 * layer — never store or display more than this.
 */
const MAX_WORDS = 20;

/**
 * Pick the first feed field that actually yields text, then cap it.
 *
 * Two traps this exists to avoid, both hit in production:
 *
 * 1. `a ?? b` falls through only on null/undefined. Estadão ships
 *    `<description></description>` — PRESENT but empty — so rss-parser hands
 *    back `contentSnippet: ""` and the old chain stopped there, never reaching
 *    a later field. Emptiness has to be judged AFTER capExcerpt strips tags
 *    and whitespace, because a description carrying only an `<img>` (UOL does
 *    this on every item) also reduces to "".
 * 2. `content:encoded` was never consulted at all, and for Estadão it is the
 *    only field with the body in it.
 *
 * The 20-word legal cap (spec §3.3) still applies to whichever field wins —
 * the source changes, the amount we keep does not.
 */
export function pickExcerpt(item: {
  contentSnippet?: unknown;
  summary?: unknown;
  content?: unknown;
  "content:encoded"?: unknown;
}): string {
  const candidates = [item.contentSnippet, item.summary, item.content, item["content:encoded"]];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const capped = capExcerpt(c);
    if (capped !== "") return capped;
  }
  return "";
}

export function capExcerpt(raw: string | undefined | null): string {
  if (!raw) return "";
  const text = raw
    .replace(/<[^>]+>/g, " ") // strip any HTML the feed sneaks in
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text.split(" ").filter(Boolean);
  if (words.length <= MAX_WORDS) return words.join(" ");
  return words.slice(0, MAX_WORDS).join(" ") + "…";
}
