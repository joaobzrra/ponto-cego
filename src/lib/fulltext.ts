/**
 * Transient full-text extraction (spec §3.1 hard rule): the classifier reads
 * the full article text fetched at classification time, held in memory only.
 * It is NEVER written to the database, never indexed, never displayed. The
 * only durable outputs are the structured classification fields.
 *
 * robots.txt is honored on every article-page fetch. When the fetch or
 * extraction fails, the caller falls back to title+excerpt and flags the
 * article low_confidence_input.
 */
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { fetchWithTimeout, readBodyCapped } from "./http";
import { robotsAllowed } from "./robots";

/** Cap what we send to the model — enough for framing, bounded for cost. */
const MAX_CHARS = 12_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;

export type FullTextResult = {
  text: string;
  /** True when we could not get real article text (excerpt-only fallback). */
  lowConfidence: boolean;
};

export async function fetchArticleText(
  url: string,
  opts: { userAgent?: string | null } = {},
): Promise<string | null> {
  try {
    if (!(await robotsAllowed(url))) return null;
    const res = await fetchWithTimeout(url, {
      timeoutMs: 20_000,
      headers: opts.userAgent ? { "user-agent": opts.userAgent } : undefined,
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !contentType.includes("text/html")) return null;
    // Cap enforced while streaming (security audit 2026-09-04).
    const html = (await readBodyCapped(res, MAX_HTML_BYTES)).toString("utf8");

    // jsdom logs CSS/script noise from real-world news pages; silence it.
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(html, { url, virtualConsole });
    const article = new Readability(dom.window.document).parse();
    dom.window.close();

    const text = article?.textContent?.replace(/\s+/g, " ").trim();
    if (!text || text.length < 200) return null; // too short to be the article
    return text.slice(0, MAX_CHARS);
  } catch {
    return null;
  }
}
