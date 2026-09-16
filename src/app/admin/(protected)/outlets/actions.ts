"use server";

import { and, eq, inArray, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import type { FeedScope } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";

export type OutletFormState = { error?: string };

export type FeedInput = { url: string; scope: FeedScope; enabled: boolean };

/**
 * One feed per line: `URL [politica|geral] [off]` (Addendum 01 §A1).
 * Scope defaults to geral; `off` keeps the feed configured but not polled.
 */
function parseFeedLines(raw: string): FeedInput[] | { error: string } {
  const feeds: FeedInput[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const [url, ...flags] = parts;
    try {
      new URL(url);
    } catch {
      return { error: `URL inválida: ${url}` };
    }
    let scope: FeedScope = "geral";
    let enabled = true;
    for (const flag of flags.map((f) => f.toLowerCase())) {
      if (flag === "politica" || flag === "política") scope = "politica";
      else if (flag === "geral") scope = "geral";
      else if (flag === "off") enabled = false;
      else return { error: `Marcador desconhecido "${flag}" em: ${line.trim()}` };
    }
    feeds.push({ url, scope, enabled });
  }
  if (feeds.length === 0) return { error: "Informe ao menos uma URL de feed." };
  return feeds;
}

function parseOutletForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");
  const feeds = parseFeedLines(String(formData.get("feeds") ?? ""));
  const fetchIntervalMinutes = Math.max(5, Number(formData.get("fetchIntervalMinutes") ?? 10));
  const complianceStatus = String(formData.get("complianceStatus") ?? "pending");
  const complianceNotes = String(formData.get("complianceNotes") ?? "").trim() || null;

  // Ownership transparency: facts + source only; the verified flag is the
  // human gate that lets it show publicly.
  const owner = String(formData.get("owner") ?? "").trim() || null;
  const ownerType = String(formData.get("ownerType") ?? "").trim() || null;
  const ownerSourceUrl = String(formData.get("ownerSourceUrl") ?? "").trim() || null;
  const ownerVerified = formData.get("ownerVerified") === "on";
  // Provenance badge + polite-UA escape hatch (see schema comments).
  const warningLabel = String(formData.get("warningLabel") ?? "").trim() || null;
  const fetchUserAgent = String(formData.get("fetchUserAgent") ?? "").trim() || null;
  const reachRaw = String(formData.get("reachWeight") ?? "").trim().replace(",", ".");
  const reachWeight = reachRaw === "" ? null : Number(reachRaw);
  if (reachWeight !== null && (!Number.isFinite(reachWeight) || reachWeight < 0)) {
    return { error: "Peso de alcance deve ser um número ≥ 0 (ou vazio)." as const };
  }
  // Reach handling lives in the actions, not here: an empty field must NOT
  // touch auto-derived (CrUX/Tranco) values, and only a filled field means a
  // manual override — parseOutletForm can't see the current DB row to tell
  // "left empty" apart from "clearing an override".
  if (ownerVerified && (!owner || !ownerSourceUrl)) {
    return {
      error: "Para marcar como verificado, preencha o dono E o link da fonte." as const,
    };
  }

  if (!name || !slug) return { error: "Nome e slug são obrigatórios." as const };
  if ("error" in feeds) return feeds;
  return {
    name,
    slug,
    feeds,
    fetchIntervalMinutes,
    complianceStatus,
    complianceNotes,
    owner,
    ownerType,
    ownerSourceUrl,
    ownerVerified,
    warningLabel,
    fetchUserAgent,
    reachWeight,
  };
}

/**
 * Manual-override semantics for the reach field: filled = explicit override
 * (source 'manual'); empty = hands-off — auto values stay untouched, except
 * when the outlet WAS manual, in which case empty means "clear the override"
 * and the monthly updater re-derives it.
 */
function reachUpdate(
  input: number | null,
  currentSource: string | null,
): Partial<{
  reachWeight: number | null;
  reachSource: string | null;
  reachRank: number | null;
  reachUpdatedAt: Date | null;
}> {
  if (input !== null) {
    return {
      reachWeight: input,
      reachSource: "manual",
      reachRank: null,
      reachUpdatedAt: new Date(),
    };
  }
  if (currentSource === "manual") {
    return { reachWeight: null, reachSource: null, reachRank: null, reachUpdatedAt: null };
  }
  return {};
}

/**
 * Makes the outlet's feeds match the submitted list: insert new URLs, update
 * scope/enabled on existing ones, and DISABLE (never delete) URLs no longer
 * listed — fetch_runs history references them.
 */
async function syncFeeds(outletId: number, wanted: FeedInput[]) {
  const urls = wanted.map((f) => f.url);
  const existing = await db
    .select()
    .from(tables.feeds)
    .where(eq(tables.feeds.outletId, outletId));
  const byUrl = new Map(existing.map((f) => [f.url, f]));

  for (const f of wanted) {
    const current = byUrl.get(f.url);
    if (!current) {
      await db.insert(tables.feeds).values({ outletId, ...f });
    } else if (current.scope !== f.scope || current.enabled !== f.enabled) {
      await db
        .update(tables.feeds)
        .set({ scope: f.scope, enabled: f.enabled })
        .where(eq(tables.feeds.id, current.id));
    }
  }
  const removed = existing.filter((f) => !urls.includes(f.url) && f.enabled);
  if (removed.length > 0) {
    await db
      .update(tables.feeds)
      .set({ enabled: false })
      .where(
        and(
          eq(tables.feeds.outletId, outletId),
          notInArray(tables.feeds.url, urls),
          inArray(
            tables.feeds.id,
            removed.map((f) => f.id),
          ),
        ),
      );
  }
}

export async function createOutlet(
  _prev: OutletFormState,
  formData: FormData,
): Promise<OutletFormState> {
  const admin = await requireAdmin();
  const parsed = parseOutletForm(formData);
  if ("error" in parsed) return parsed;
  const { feeds, reachWeight, ...outletValues } = parsed;

  const [outlet] = await db
    .insert(tables.outlets)
    .values({ ...outletValues, ...reachUpdate(reachWeight, null) })
    .returning();
  await syncFeeds(outlet.id, feeds);
  await writeAudit(admin.id, "outlet.create", { type: "outlet", id: outlet.id }, parsed);
  revalidatePath("/admin/outlets");
  return {};
}

export async function updateOutlet(
  _prev: OutletFormState,
  formData: FormData,
): Promise<OutletFormState> {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  const parsed = parseOutletForm(formData);
  if ("error" in parsed) return parsed;
  const { feeds, reachWeight, ...outletValues } = parsed;

  const [current] = await db
    .select({ reachSource: tables.outlets.reachSource })
    .from(tables.outlets)
    .where(eq(tables.outlets.id, id));
  await db
    .update(tables.outlets)
    .set({ ...outletValues, ...reachUpdate(reachWeight, current?.reachSource ?? null) })
    .where(eq(tables.outlets.id, id));
  await syncFeeds(id, feeds);
  await writeAudit(admin.id, "outlet.update", { type: "outlet", id }, parsed);
  revalidatePath("/admin/outlets");
  return {};
}

export async function toggleOutlet(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  const [outlet] = await db.select().from(tables.outlets).where(eq(tables.outlets.id, id));
  if (!outlet) return;
  await db
    .update(tables.outlets)
    .set({ enabled: !outlet.enabled })
    .where(eq(tables.outlets.id, id));
  await writeAudit(admin.id, outlet.enabled ? "outlet.disable" : "outlet.enable", {
    type: "outlet",
    id,
  });
  revalidatePath("/admin/outlets");
}
