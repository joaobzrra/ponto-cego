import { inArray } from "drizzle-orm";
import { db, tables } from "@/db";

/*
 * Resumo do dia (spec 2026-09-03 §2). Pure helpers first (tested), then the
 * one DB read the home page needs. Generation lives in worker/briefing.ts.
 */
export const BRIEFING_ENABLED = process.env.BRIEFING_ENABLED !== "0";
export const BRIEFING_LIMIT = 5;
export const BRIEFING_MAX_CHARS = 160;

export function readingMinutes(lines: string[]): number {
  const words = lines.join(" ").split(/\s+/).filter((w) => w.length > 0).length;
  return Math.max(1, Math.ceil(words / 200));
}

/** novitaChat forces response_format json_object; the prompt asks for {"linha": "..."} . */
export function parseBriefingLine(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { linha?: unknown };
    if (typeof parsed.linha !== "string") return null;
    const line = parsed.linha.trim().replace(/\s+/g, " ");
    if (line.length === 0 || line.length > BRIEFING_MAX_CHARS) return null;
    return line;
  } catch {
    return null;
  }
}

export async function briefingLinesFor(clusterIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (clusterIds.length === 0) return out;
  const rows = await db
    .select({ clusterId: tables.briefingLines.clusterId, line: tables.briefingLines.line })
    .from(tables.briefingLines)
    .where(inArray(tables.briefingLines.clusterId, clusterIds));
  for (const r of rows) out.set(r.clusterId, r.line);
  return out;
}
