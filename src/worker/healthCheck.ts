import { and, eq, isNull } from "drizzle-orm";
import { db, tables } from "@/db";
import { computeAllHealth, type FeedHealth } from "@/lib/health";
import { sendAlertEmail } from "@/lib/mailer";

/**
 * Alert lifecycle with email dedup (spec §5): one email when a feed enters
 * offline/degraded, one on recovery — never one per poll cycle. The alerts
 * table is the dedup state, keyed per feed (Addendum 01 §A1).
 */
export async function runHealthChecks() {
  const all = await computeAllHealth();
  for (const h of all.filter((h) => h.enabled)) {
    if (h.state === "offline" || h.state === "degraded") {
      await ensureAlert(h);
    } else if (h.state === "online") {
      await resolveAlerts(h);
    }
    // "pending" (no runs yet) neither alerts nor resolves.
  }
}

function feedLabel(h: FeedHealth) {
  return `${h.name} [${h.scope}]`;
}

async function ensureAlert(h: FeedHealth) {
  const [open] = await db
    .select()
    .from(tables.alerts)
    .where(
      and(
        eq(tables.alerts.feedId, h.feedId),
        eq(tables.alerts.type, h.state),
        isNull(tables.alerts.resolvedAt),
      ),
    );
  if (open) return; // already alerted, still unresolved

  const [alert] = await db
    .insert(tables.alerts)
    .values({ outletId: h.outletId, feedId: h.feedId, type: h.state })
    .returning();

  const sent = await sendAlertEmail(
    `[Ponto Cego] ${feedLabel(h)} está ${h.state === "offline" ? "OFFLINE" : "DEGRADADO"}`,
    [
      `Veículo: ${h.name} (${h.slug})`,
      `Feed: ${h.feedUrl} (${h.scope})`,
      `Estado: ${h.state}`,
      `Motivo: ${h.reason}`,
      `Última coleta OK: ${h.lastSuccessfulFetch?.toISOString() ?? "nunca"}`,
      `Último parse OK: ${h.lastSuccessfulParse?.toISOString() ?? "nunca"}`,
      `Novos artigos (6h/24h): ${h.new6h}/${h.new24h}`,
      ``,
      `Dica: comece diffando os snapshots recentes do feed no painel.`,
    ].join("\n"),
  );
  if (sent) {
    await db
      .update(tables.alerts)
      .set({ emailedAt: new Date() })
      .where(eq(tables.alerts.id, alert.id));
  }
}

async function resolveAlerts(h: FeedHealth) {
  const open = await db
    .select()
    .from(tables.alerts)
    .where(and(eq(tables.alerts.feedId, h.feedId), isNull(tables.alerts.resolvedAt)));
  for (const alert of open) {
    await db
      .update(tables.alerts)
      .set({ resolvedAt: new Date() })
      .where(eq(tables.alerts.id, alert.id));
    const sent = await sendAlertEmail(
      `[Ponto Cego] ${feedLabel(h)} voltou ao normal`,
      `Veículo: ${h.name} (${h.slug})\nFeed: ${h.feedUrl} (${h.scope})\nAlerta anterior: ${alert.type} desde ${alert.triggeredAt.toISOString()}\nEstado atual: online — ${h.reason}`,
    );
    if (sent) {
      await db
        .update(tables.alerts)
        .set({ recoveryEmailedAt: new Date() })
        .where(eq(tables.alerts.id, alert.id));
    }
  }
}
