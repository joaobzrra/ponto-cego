/*
 * Keyword-bold rule (spec §4): the phrase of a headline that matches a
 * current trending chip is emphasised; nothing else is. Matching is
 * case-insensitive, accent-insensitive and whole-word; the ORIGINAL text is
 * returned untouched inside the segments. Pure — no React, no DB.
 */
export type Segment = { text: string; strong: boolean };

/** One base character per input character, so indexes line up 1:1. */
function fold(s: string): string {
  let out = "";
  for (const ch of s) {
    const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    out += (base.length > 0 ? base[0] : ch).toLowerCase();
  }
  return out;
}

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

export function emphasiseKeywords(title: string, chips: string[]): Segment[] {
  const chars = Array.from(title);
  const folded = fold(title);
  const taken = new Array<boolean>(chars.length).fill(false);
  const ranges: Array<[number, number]> = [];
  const needles = [...new Set(chips.map((c) => fold(c.trim())).filter((c) => c.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  for (const needle of needles) {
    let from = 0;
    while (from <= folded.length - needle.length) {
      const at = folded.indexOf(needle, from);
      if (at < 0) break;
      const end = at + needle.length;
      const wholeWord = !isWordChar(folded[at - 1]) && !isWordChar(folded[end]);
      const free = !taken.slice(at, end).some(Boolean);
      if (wholeWord && free) {
        ranges.push([at, end]);
        taken.fill(true, at, end);
      }
      from = at + 1;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const segs: Segment[] = [];
  let cursor = 0;
  for (const [a, b] of ranges) {
    if (a > cursor) segs.push({ text: chars.slice(cursor, a).join(""), strong: false });
    segs.push({ text: chars.slice(a, b).join(""), strong: true });
    cursor = b;
  }
  if (cursor < chars.length) segs.push({ text: chars.slice(cursor).join(""), strong: false });
  return segs.length > 0 ? segs : [{ text: title, strong: false }];
}