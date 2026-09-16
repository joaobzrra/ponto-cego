# Project Briefing — Ponto Cego: System Architecture & UI/UX Blueprint
## v2 — Claude Code Handoff Spec (July 2026)

> **Changelog from v1:** resolved the classification-input contradiction (transient full-text fetch); replaced raw -100/+100 scores with 7-band classification + calibration set; locked the tech stack to a single-language monolith; elevated event clustering to a first-class system; made the daily synthesis human-approved; switched thumbnails from hotlink to re-hosted low-res; added LGPD section; made outlet-level scores rolling aggregates; specified admin security, payments, alerting, raw-snapshot retention, and a private calibration period before launch.

---

## 1. Executive Summary

**Ponto Cego** is a politically neutral news aggregator for the Brazilian media landscape. Modeled conceptually after Ground News, it programmatically deduplicates, clusters, and analyzes real-time Brazilian journalism across the ideological spectrum (Left, Center, Right). The platform emphasizes security, data density, algorithmic transparency, and a rigid desaturated UI that positions color strictly as an informational data metric.

**Team & build model:** built and maintained by 1–2 people (one designer/admin, engineering via Claude Code). Every architectural decision below optimizes for **maintenance comprehensibility at that team size** — a single stack, minimal moving parts, human review at the editorially dangerous points.

**Model-agnostic principle:** all LLM usage goes through a thin internal client. Model IDs (`claude-haiku-4-5-20251001` etc.) are configuration values, pinned per version, swappable without code changes. If the build ends up running on Opus or a later model family, nothing in this spec changes except config.

---

## 2. Interface & Visual Identity (Locked State)

Unchanged from v1 except where noted:

* **The Monochromatic Rule:** fixed dark charcoal/slate-grey canvas (`#1C1917` to `#78716C`). No dark/light mode toggle.
* **Data Coloration:** color reserved solely for data visualization bars — Viés Esquerda: Muted Crimson Red; Viés Centro: Slate Grey; Viés Direita: Royal Blue. All photography greyscale.
* **Tri-Pivot Layout:**
  * **Main Frame (70%):**
    * **Destaque do Dia:** hero element with a programmatically synthesized summary attributed to `FATO CENTRAL AGREGADO (XX FONTES)`. **v2 change: draft-by-AI, publish-by-human.** The synthesis is generated as a draft and requires one-click admin approval before display. Until approved, the hero shows the previous day's approved item or a neutral cluster headline. One story a day — trivial approval cost, existential brand protection.
    * **3-Column Split Grid:** Viés Esquerda / Centro / Direita below the hero.
    * **Inline Bias Bars — v2 change:** every card displays a horizontal bias bar rendering the article's **band** (see 3.1). The UI may render a continuous-looking slider position, but it is derived from the band, never from a raw model number. No numeric score like "-78" is displayed — false precision undermines credibility the moment two similar articles show implausibly exact different numbers.
  * **Telemetry & Cloud Sidebar (30%):** Meu Perfil de Viés (see §7 privacy constraints), Tópicos em Alta, Subnoticiados (Blindspot Engine).
* **Mobile — Filter-Bubble-Safe:** tabbed switcher (Esquerda / Centro / Direita), equal visual weight, no default landing tab. Horizontal swipe is post-MVP.

---

## 3. Classification Architecture

### 3.1 LLM-based classification — corrected input model

**Hard rule (resolves the v1 contradiction):** the classifier reads the **full article text, fetched transiently**. It is held in memory (or a short-lived processing buffer), classified, and discarded. Full text is **never** written to the permanent database, never indexed, never displayed. Public storage remains: capped excerpt, low-res greyscale thumbnail, metadata, redirect URL. Rationale: bias cannot be scored from a headline + 20 words; crawling-to-analyze is a legally distinct posture from republishing. Both go on the pre-launch legal review list.

**Pipeline per article:**
1. Ingest worker fetches full text (readability-style extraction from the article URL; fall back to RSS content if fetch fails, flag as `low_confidence_input`).
2. Send to Haiku-tier model with the versioned rubric (prompt-cached) via the **Batch API** — classification latency of 15–30 min is invisible for a news aggregator and halves cost.
3. Structured JSON out: `{band, confidence, keywords[], suggested_cluster_id, rubric_version, model_id}`.
4. Store the JSON; discard the full text.

**Banding, not coordinates:** classify into **7 bands** (e.g., E3 / E2 / E1 / C / D1 / D2 / D3). LLMs do not produce reproducible point scores; bands are stable, auditable, and defensible. Outlet-level positioning is a **rolling aggregate of article bands over the trailing 90 days**, displayed as such ("média dos últimos 90 dias") — we score articles, never assign editorial verdicts to companies.

**Rubric requirements:**
* Versioned, admin-editable without deploy, with change log (unchanged from v1).
* Must contain **few-shot examples**: real Brazilian article excerpts with expected bands. Abstract Left/Center/Right definitions alone will not anchor consistency.
* `rubric_version` stored on every classification row.

**Calibration set (new, mandatory):** ~50–100 hand-labeled articles spanning all bands and major outlets. An admin-panel action re-runs the set against the current rubric + model and reports agreement/drift. Run it: before launch, after every rubric edit, after every model version change. Pin model versions in config; never float on "latest."

**Model tiers:** Haiku-tier for volume classification; Sonnet-tier (or best available) for the on-demand "paste a link" breakdown and the daily synthesis draft. Cost at MVP scale (~1,000–2,000 articles/day, batch + caching): roughly US$2–6/day.

### 3.2 Ingestion

* Poll RSS feeds/sitemaps of **15–30 curated outlets** every ~10 minutes. This is a light workload; no exotic infrastructure.
* **Raw snapshot retention (new):** keep the raw fetched feed XML / article HTML for the trailing **7 days per outlet**, in cheap storage, for debugging. When a source goes Degraded, the fix starts with diffing snapshots, not guessing.
* Per-outlet config: feed URL(s), fetch interval, parser profile, robots.txt/syndication compliance status, onboarding date.

### 3.3 Content Model — RSS-Excerpt Display, Redirect-First (Legal Safety Layer)

Unchanged as the public-display rule; clarified against 3.1:

* **Displayed/stored text:** server-side hard cap (~15–20 words) applied in code regardless of feed length. Never store or display a rewritten summary of a single source article. `FATO CENTRAL AGREGADO` describes the aggregate event across multiple sources only.
* **Images (v2 change — re-host, don't hotlink):** ingest worker downloads the source image once, resizes to ~300px, converts to greyscale **server-side**, stores locally, serves from our domain. Hotlinking breaks against news CDN referrer rules and leaks reader IPs to source outlets. Original color image is never served or retained.
* **Always redirect to the original publisher's article page.** Attribution (outlet + link) visible pre-redirect.
* **Per-outlet compliance check** before onboarding (robots.txt, syndication terms), plus the informal-permission outreach practice for top sources.
* **Takedown/correction process from day one:** a public contact route, an admin action that unpublishes an article/cluster immediately, and a logged response-time record. Responsiveness is a meaningful factor under Brazil's current platform-liability standards.
* Engineering guidance, not legal advice — a Brazilian media/IP lawyer reviews excerpt length, image handling, the transient full-text fetch, and outlet bias-labeling before public launch.

### 3.4 Deduplication & Event Clustering (elevated — this is the hardest technical system)

Everything user-visible (3-column comparison, Blindspot Engine, coverage-asymmetry stats) depends on clustering being right. Design:

1. **Embed every ingested article** (title + excerpt + transient lead paragraphs) and store the vector in `pgvector`.
2. **Wire-copy dedup FIRST:** near-duplicate detection (embedding cosine similarity above a high threshold, or MinHash if evaluation favors it) marks syndicated wire copy (Agência Brasil, Reuters, etc.) as `duplicate_of`, excluded from spectrum math. Otherwise wire republication reads as fake organic consensus.
3. **Cluster candidates** via embedding similarity within a time window (e.g., 72h).
4. **Haiku confirm/reject step** for borderline pairs ("do these describe the same real-world event?"), storing a confidence score.
5. **Admin manual merge/split tool** as the permanent backstop. Design for graceful degradation, not 100% automation.
6. Every cluster gets an `EventID`; spectrum distribution, blindspot detection, and the daily synthesis operate on clusters.

Expect weeks of post-launch tuning; the admin tools are what make that survivable.

---

## 4. Tech Stack (locked for MVP)

One boring monolith. The dominant cost at 1–2 people is comprehensibility, not throughput.

* **Language:** one of TypeScript (Next.js + Node worker) or Python (Django/FastAPI + worker). Claude Code picks at project start and **never splits the stack**. No Go/Rust scraper fleet — polling 30 feeds does not need it.
* **Database:** PostgreSQL for everything — articles, clusters, feedback, users, audit log — with **pgvector** for embeddings. No separate vector DB, no Redis unless a concrete need appears.
* **Jobs:** a pg-backed job queue (or cron-driven stages for earliest MVP) running the pipeline: fetch → snapshot → dedup → classify (batch) → cluster → review → publish.
* **Hosting:** one VPS, automated daily backups (DB + snapshots), Cloudflare in front (caching, rate limiting, basic WAF).
* **LLM access:** thin internal client wrapping the Anthropic API — batch endpoint, prompt caching on the rubric, pinned model IDs from config, structured-output parsing, retry/backoff, per-day spend ceiling with alert.

---

## 5. Admin Panel & Controls

Secure, audited backend for 2 admins:

* **Manual publishing & structural override** — correct band assignments, merge/split clusters, edit/approve the `FATO CENTRAL AGREGADO` draft (approval is required, per §2).
* **User management** — permissions, subscription/entitlement status (entitlement only; no payment data, per §8).
* **Outlet Health Dashboard:** three states per source:
  * **Online** — fetching and parsing normally.
  * **Degraded** — reachable but 0/abnormally few new articles vs. that outlet's own baseline (the silent-parse-failure state that matters most).
  * **Offline** — unreachable.
  Tracks last successful fetch, last successful parse, trailing-N-hour article count. **Alerting is push, not pull:** threshold breach (e.g., 0 new articles in 6h during a normal publishing window) sends an email to maintainers.
* **Bias Correction Queue:** reader feedback items land here for human review. Never auto-adjusts scores.
* **Rubric management:** versioned editor with change log + one-click calibration-set re-run showing drift vs. previous version.
* **Audit log:** every override, approval, rubric change, and unpublish action recorded with admin identity and timestamp.

**Admin security (new, explicit):**
* Passkeys or TOTP mandatory for both admins; no email-only password reset.
* Admin panel on a separate path/subdomain with IP allowlist or VPN requirement.
* Session timeouts, rate-limited login, all admin actions over the audit log above.
* Public attack surface is deliberately tiny: the only unauthenticated write endpoint on the whole site is the Like/Dislike signal (§9), rate-limited per session and per article.

---

## 6. Unknown Unknowns (carried forward, status updated)

* **Mobile Filter-Bubble Effect** — addressed via equal-weight tabs; revisit with behavior data.
* **Legal/Copyright** — mitigated via §3.3 + transient-fetch rule; remains the top external risk; one-time professional legal review pre-launch + informal outlet outreach.
* **Wire Copy Inflation** — addressed as a mandatory pre-clustering dedup stage (§3.4.2).
* **Feedback-Loop Gaming** — human review queue only; aggregate display can additionally hide percentages below a minimum vote count to blunt brigading optics.
* **Scraper Fragility** — permanent recurring cost; defenses are the Health Dashboard, push alerting, and raw snapshot diffing. Budget maintenance time indefinitely.
* **Score credibility (new):** a launch with visibly wrong labels is unrecoverable. Mitigation: banding, calibration set, human queue, and the private calibration period in §10.

---

## 7. Privacy & LGPD (new section — was implicit in v1)

Ponto Cego tracks reading behavior and operates in Brazil; the **LGPD (Lei 13.709/2018)** applies explicitly:

* Published privacy policy; declared legal basis for the telemetry (consent or legitimate interest — decide with legal review).
* **Split identity architecture (from v1 §5, now mandatory at schema design):** billing/auth identity and bias-profile telemetry live in separate stores, linked only by a pseudonymous profile ID. Reading history is never stored directly against email/payment identity.
* Feedback signals store: article ID, direction, timestamp, anonymized session identifier. No IP retention beyond transient rate-limiting windows.
* Data deletion on request: one admin action deletes a user's telemetry + account, logged.
* Free-tier readers should be usable without an account at all; the profile is opt-in.

---

## 8. Monetization

* **No advertising** — unchanged, structural brand decision.
* **PIX donation link** — low-friction one-off support.
* **Subscription tier** — free basic Meu Perfil de Viés; paid tier for historical trends, national-average comparison, exportable reports. Tier boundaries decided post-launch with real usage data.
* **Payments (new, explicit):** integrate a Brazilian PSP — Mercado Pago, Asaas, Efí, or Stripe-BR with Pix support — including **Pix Automático** for recurring subscriptions (card penetration in Brazil makes card-only recurring a mistake). We never touch payment data: PSP-hosted checkout, webhooks update entitlement status in our DB, and that's the entire integration surface.

---

## 9. Reader Feedback Loop — "Is this correctly labeled?"

* Like/Dislike prompt pre-redirect.
* Stored: article ID, direction, timestamp, anonymized session ID (§7 constraints).
* Rate-limited per session and per article; feeds the Bias Correction Queue for human review only.
* Aggregate agreement ("73% dos leitores concordaram") is a candidate for public display on the card, with a minimum-vote threshold before percentages show.

---

## 10. Build Sequence & Launch Gate

Suggested order for Claude Code (each stage proven before the next):

1. **Skeleton:** monolith scaffold, Postgres schema (including split-identity design and audit log), admin auth.
2. **Ingestion:** outlet config, RSS polling, raw snapshots, excerpt capping, thumbnail pipeline (re-host, resize, greyscale at ingest).
3. **Health Dashboard + alerting** — built *before* scale-out, since it's the tool that makes stages 4–6 debuggable.
4. **Classification:** LLM client (batch, caching, pinned models, spend ceiling), rubric store + editor, banding, calibration-set runner.
5. **Dedup + clustering:** embeddings, wire-copy dedup, cluster candidates, confirm step, admin merge/split.
6. **Public frontend:** tri-pivot layout, bias bars, mobile tabs, redirect flow, feedback prompt.
7. **Daily synthesis** (draft + approval flow), Blindspot Engine, Tópicos em Alta.
8. **Payments/entitlements**, subscription-gated features.

**Launch gate — private calibration period (mandatory):** 2–4 weeks running the full pipeline on real feeds, privately. Exit criteria: calibration-set agreement at an acceptable threshold, clustering spot-check error rate acceptable, all onboarded outlets Green/documented, legal review complete. The product *is* the credibility of the labels; it does not go public before the numbers deserve trust.

---

*This document and `What_is_Ponto_Cego_v2.md` supersede v1. Decisions here remain open to pressure-testing — written down is not final.*
