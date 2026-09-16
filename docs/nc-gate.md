# Ponto Cego — Spec Addendum 01: Feed Selection & Classifiability Gate
## Supplements BUILD_SPEC v2 (July 2026) — apply before enabling live classification (stage 4 flag flip)

**Context:** Stage 1–3 soak revealed that general-feed outlets (G1, Folha) deliver a firehose where most items have no political dimension (celebrity, local crime, weather, human interest). Running these through the Left/Right rubric produces meaningless bands, wastes API spend, and — worst — dilutes outlet 90-day aggregates toward fake neutrality. Two changes fix this at different layers.

---

## A1. Per-Outlet Feed Selection (ingestion layer)

**Change to outlet config (§3.2):** an outlet may have **multiple named feeds**, each with its own URL and a `feed_scope` field:

* `politica` — section-specific political feed. **Preferred wherever the outlet offers one** (G1 and Folha both do; check every outlet during onboarding).
* `geral` — general/all-content firehose. Used only when no section feed exists, or deliberately alongside `politica` if we want an outlet's full volume for health-baseline purposes.

**Rules:**
1. Articles ingested from a `politica` feed are marked `feed_scope=politica` and go to classification by default.
2. Articles from `geral` feeds still pass through the classifiability gate (A2) before any API call.
3. If an article appears in both feeds of the same outlet (same URL), dedupe to one row, keeping the `politica` scope.
4. Health Dashboard baselines are **per feed**, not per outlet — a política feed publishing 8/day and a geral feed publishing 100/day must not share a Degraded threshold.
5. Onboarding checklist gains a step: "section-specific RSS available? If yes, configure it; record the geral feed URL in config either way."

**Migration:** existing 663 ingested articles get `feed_scope=geral` (they came from general feeds). No reprocessing needed — the gate handles them if/when they're ever classified.

---

## A2. Classifiability Gate (classification layer)

**Principle:** "not politically classifiable" is a **first-class classification outcome**, not an error state.

### Schema change

Extend the classification result (§3.1) so `band` accepts an 8th value:

```
band: E3 | E2 | E1 | C | D1 | D2 | D3 | NC
```

`NC` = *Não Classificável* — the article has no meaningful position on the political spectrum (celebrity, sports, weather, accidents, non-political local crime, entertainment, human interest, service journalism).

Important distinction the rubric must make explicit: **`C` (Centro) and `NC` are different things.** `C` means the article covers a political topic in a balanced/neutral way. `NC` means the article isn't about politics at all. Conflating them is exactly the aggregate-dilution bug this addendum exists to prevent.

### Pipeline change

**One API call, not two.** Do not add a separate "is this political?" pre-call — the gate is part of the same classification prompt. The rubric instructs the model: first determine classifiability; if `NC`, return `{band: "NC", confidence, reason}` and skip the rest of the analysis (keywords/cluster suggestion optional or empty for NC). Same cost per call, roughly, and NC responses will be shorter (cheaper output).

**Optional zero-cost pre-filter (implement only if trivial):** a keyword/section heuristic on the article URL path (e.g., `/pop-arte/`, `/esporte/`, `/turismo-e-viagem/` on G1) may mark obvious NC candidates as `NC_heuristic` without any API call. If implemented: heuristic NC must be per-outlet configurable, conservative (when in doubt, send to the model), and logged distinctly so we can audit its false-negative rate during calibration. This is an optimization, not a requirement — skip it if it adds complexity.

### Exclusion rules — where NC articles must NOT count

`NC` articles are excluded from **all** spectrum math:

1. **Outlet 90-day rolling aggregate** (§3.1) — computed over classifiable articles only. The aggregate display should state its denominator: "média dos últimos 90 dias (N artigos políticos)".
2. **Cluster spectrum distribution** — an NC article can still belong to an event cluster (e.g., a disaster covered by everyone), but the cluster's Left/Center/Right coverage bars count only banded articles.
3. **Blindspot Engine (Subnoticiados)** — asymmetry detection operates on banded articles only.
4. **Tópicos em Alta** — implementer's choice; NC keywords may be included (trending topics aren't inherently political) but must be visually indistinguishable from the political feed only if that doesn't confuse the sidebar's purpose. Default: include, revisit with usage data.

`NC` articles **remain fully visible** in:
* The public site's article listings under their outlet (they're real news; we're an aggregator).
* Admin Artigos list — add `NC` to the status filter dropdown.
* Ingestion counts and Health Dashboard baselines.

### Feedback loop interaction

The Like/Dislike "is this correctly labeled?" prompt should **not appear** on NC articles (there's no label to dispute). If a reader believes an NC article *should* have been classified, that's a rarer, higher-signal event — acceptable to defer a "report" mechanism for it to post-MVP.

### Calibration set (§3.1) update

The 50–100 article calibration set must now include **10–20 NC examples**, deliberately including hard cases: crime stories with political adjacency (operations against factions, corruption arrests), economy service pieces, celebrity items touching politicians. The calibration runner reports NC agreement separately from band agreement.

### Admin visibility

* Artigos list: status filter gains `NC`; a per-outlet stat "% NC (trailing 7d)" appears on the Veículos page. A `geral`-feed outlet running 60–70% NC is expected; a `politica`-feed outlet running high NC signals a mis-set rubric or wrong feed URL.
* Bias Correction Queue: admins can manually flip NC↔banded, audited like any override.

---

## A3. Cost model note (informational)

With política feeds preferred and the NC gate active, expected classification volume drops to a fraction of the v2 estimate (which assumed the full firehose). Keep the per-day spend ceiling from §4 as configured; expect actual spend materially below the US$2–6/day estimate at 5 outlets, re-evaluate at full outlet count.

---

## A4. Acceptance criteria

1. Outlet config supports multiple feeds with `feed_scope`; G1 and Folha switched to their política feeds (geral feeds retained in config, disabled or baseline-only).
2. Classification schema and rubric produce `NC` as a valid band; `C` vs `NC` distinction present in rubric text with examples.
3. All four exclusion rules verifiably applied (aggregate, cluster bars, blindspot, denominator display).
4. Feedback prompt suppressed on NC articles.
5. Calibration set contains NC hard cases; runner reports NC agreement separately.
6. Admin: NC filter, % NC per outlet stat, NC↔band override with audit log entry.
7. Health baselines are per feed.

*This addendum supersedes conflicting details in BUILD_SPEC v2 §3.1–3.2. Everything else in v2 stands.*
