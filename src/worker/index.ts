/**
 * Ponto Cego ingestion worker — long-running process, separate from Next.js.
 *
 *   npm run worker
 *
 * Loop design (spec §3.2 / §4): poll each enabled outlet on its own interval
 * (default 10 min), with a global concurrency cap. One bad feed never stops
 * the loop. Retention runs daily; health checks every cycle (stage 3).
 */
import "./force-internal-fetch"; // MUST stay first — see that file's comment
import { asc, desc, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { runBriefingCycle } from "./briefing";
import { runClassifierCycle, sweepOrphanedClassifyState } from "./classifier";
import { runClusterCycle } from "./cluster";
import { runEmbedCycle } from "./embed";
import { runHealthChecks } from "./healthCheck";
import { runNewsletterCycle } from "./newsletter";
import { pollOutlet } from "./poller";
import { runRetention } from "./retention";
import { structuredLog } from "@/lib/structured-log";

const TICK_MS = 30_000;
const CONCURRENCY = 4;
const HEALTH_CHECK_EVERY_MS = 5 * 60 * 1000;
const RETENTION_EVERY_MS = 24 * 60 * 60 * 1000;
const CLASSIFY_EVERY_MS = 5 * 60 * 1000;
// Stage 5 (inert until EMBED_ENABLED=1 — see OPUS-HANDOFF.md).
const EMBED_ENABLED = process.env.EMBED_ENABLED === "1";
const EMBED_EVERY_MS = 5 * 60 * 1000;
let lastEmbed = 0;
// Fix round 1: a missing RESEND_API_KEY makes runNewsletterCycle report idle
// every 30s tick — log that once per 10 minutes, not every tick.
const NEWSLETTER_NOKEY_LOG_EVERY_MS = 10 * 60 * 1000;
let lastNewsletterNoKeyLog = 0;

const lastPolled = new Map<number, number>();
let lastHealthCheck = 0;
let lastRetention = 0;
let lastClassify = 0;

function log(msg: string) {
  structuredLog("info", "worker", { message: msg });
}

async function loadLastRunTimes() {
  const outlets = await db.select({ id: tables.outlets.id }).from(tables.outlets);
  for (const { id } of outlets) {
    const [run] = await db
      .select({ startedAt: tables.fetchRuns.startedAt })
      .from(tables.fetchRuns)
      .where(eq(tables.fetchRuns.outletId, id))
      .orderBy(desc(tables.fetchRuns.startedAt))
      .limit(1);
    if (run) lastPolled.set(id, run.startedAt.getTime());
  }
}

async function pollDueOutlets() {
  const outlets = await db
    .select()
    .from(tables.outlets)
    .where(eq(tables.outlets.enabled, true))
    .orderBy(asc(tables.outlets.id));

  const now = Date.now();
  const due = outlets.filter((o) => {
    const last = lastPolled.get(o.id) ?? 0;
    return now - last >= o.fetchIntervalMinutes * 60 * 1000;
  });
  if (due.length === 0) return;

  // Simple promise pool — CONCURRENCY outlets in flight at once.
  const queue = [...due];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let outlet = queue.shift(); outlet; outlet = queue.shift()) {
      lastPolled.set(outlet.id, Date.now());
      try {
        const results = await pollOutlet(outlet);
        if (results.length === 0) log(`${outlet.slug}: no enabled feeds`);
        for (const r of results) {
          log(
            `${r.outlet} [${r.scope}]: ${r.notModified ? "not modified" : `${r.articlesNew}/${r.articlesSeen} new`}` +
              (r.error ? ` — ERROR: ${r.error}` : ""),
          );
        }
      } catch (err) {
        log(`${outlet.slug}: poll crashed — ${err instanceof Error ? err.message : err}`);
      }
    }
  });
  await Promise.all(workers);
}

async function tick() {
  await pollDueOutlets();

  if (Date.now() - lastHealthCheck >= HEALTH_CHECK_EVERY_MS) {
    lastHealthCheck = Date.now();
    try {
      await runHealthChecks();
    } catch (err) {
      log(`health check failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (Date.now() - lastClassify >= CLASSIFY_EVERY_MS) {
    lastClassify = Date.now();
    try {
      await runClassifierCycle();
    } catch (err) {
      log(`classifier cycle failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (EMBED_ENABLED && Date.now() - lastEmbed >= EMBED_EVERY_MS) {
    lastEmbed = Date.now();
    try {
      const r = await runEmbedCycle();
      if (r.serviceDown) log("embed: Ollama indisponível — ciclo pulado");
      else if (r.embedded > 0) log(`embed: ${r.embedded} artigos (${r.remaining} restantes)`);
      if (!r.serviceDown) {
        const { dups, clusters, confirm } = await runClusterCycle(false);
        const attached = clusters.filter((c) => c.action === "attach").length;
        const created = clusters.filter((c) => c.action === "new").length;
        const review = clusters.filter((c) => c.action === "review").length;
        if (dups.length + attached + created + review > 0) {
          const confirmNote =
            review === 0
              ? ""
              : confirm.attached + confirm.separated + confirm.unresolved > 0
                ? ` | confirmação de ${review}: ${confirm.attached} anexados, ${confirm.separated} separados, ` +
                  `${confirm.unresolved} sem resposta, ~US$${confirm.usd.toFixed(3)}`
                : ` | ${review} na faixa de revisão (confirmação desligada)`;
          log(
            `cluster: ${dups.length} duplicatas, ${attached} anexados, ${created} novos${confirmNote}`,
          );
        }
        const b = await runBriefingCycle();
        if (b.generated + b.skipped > 0) {
          log(`briefing: ${b.generated} linhas geradas, ${b.skipped} puladas, ~US$${b.usd.toFixed(3)}`);
        }
      }
    } catch (err) {
      log(`embed/cluster cycle failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Newsletter (spec 2026-09-04): cheap guard every tick; sends once per BRT day.
  try {
    const n = await runNewsletterCycle();
    if (n.action !== "idle") {
      log(`newsletter ${n.date}: ${n.action}${n.recipients !== undefined ? ` para ${n.recipients}` : ""}`);
    } else if (n.reason && Date.now() - lastNewsletterNoKeyLog >= NEWSLETTER_NOKEY_LOG_EVERY_MS) {
      lastNewsletterNoKeyLog = Date.now();
      log(`newsletter ${n.date}: idle (${n.reason})`);
    }
  } catch (err) {
    log(`newsletter failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (Date.now() - lastRetention >= RETENTION_EVERY_MS) {
    lastRetention = Date.now();
    try {
      const { snapshotsDeleted, thumbsDeleted, fetchRunsDeleted } = await runRetention();
      log(
        `retention: ${snapshotsDeleted} snapshots, ${thumbsDeleted} thumbs, ` +
          `${fetchRunsDeleted} fetch_runs removidos`,
      );
    } catch (err) {
      log(`retention failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// Crash policy: stray promise rejections are logged and survived; truly
// uncaught exceptions (e.g. the npm-undici socket-parser assertion — root
// cause fixed via force-internal-fetch.ts, 2026-07-09) log and exit(1) — the
// soak-start supervisor loop relaunches the worker in seconds.
process.on("unhandledRejection", (reason) => {
  log(`unhandled rejection (continuing): ${reason instanceof Error ? reason.stack : reason}`);
});
process.on("uncaughtException", (err) => {
  log(`uncaught exception (exiting for supervisor restart): ${err.stack ?? err}`);
  process.exit(1);
});

async function main() {
  log("Ponto Cego worker starting");
  try {
    await sweepOrphanedClassifyState();
  } catch (err) {
    log(`varredura de partida falhou (seguindo mesmo assim): ${err instanceof Error ? err.message : err}`);
  }
  await loadLastRunTimes();
  // Stagger nothing on boot: first tick polls everything due, then settle into cadence.
  for (;;) {
    try {
      await tick();
    } catch (err) {
      log(`tick failed: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main().catch((err) => {
  console.error("worker fatal:", err);
  process.exit(1);
});
