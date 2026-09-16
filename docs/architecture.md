## 1. Executive Summary

**Ponto Cego** is an unchangeable, politically neutral news aggregator for the Brazilian media landscape. Modeled conceptually after platforms like Ground News, it programmatically splits, clusters, and analyzes real-time Brazilian journalism across the ideological spectrum (Left, Center, Right). The platform emphasizes security, data density, absolute algorithmic transparency, and a rigid, desaturated user interface that positions color strictly as an informational data metric rather than a decorative choice.

**Team & build model:** Ponto Cego is built and maintained by 1–2 people, using Claude Code / Claude Fable as the primary engineering accelerant, and Claude's API for the bias-classification pipeline (see Section 3). This is a deliberate scope decision — the architecture below is designed to be buildable and operable at this team size, not a scaled-team enterprise build.

---

## 2. Interface & Visual Identity (Locked State)

As established and verified in the UI evolution up to `WireframeExample.png`, the frontend layout is bound to the following constraints:

* **The Monochromatic Rule:** The site operates exclusively on a fixed dark charcoal/slate-grey canvas (`#1C1917` to `#78716C`). No dark/light mode toggle is permitted, reinforcing that "reality cannot be visually altered or toggled."
* **Weaponized Data Coloration:** Color is stripped entirely from structural layouts, typography, and site photography (which uses an explicit greyscale opacity filter). High-intensity colors are reserved solely for data visualization bars:
  * **Viés Esquerda (Left):** Muted Crimson Red.
  * **Viés Centro (Center):** Slate/Neutral Grey.
  * **Viés Direita (Right):** Royal Blue.
* **The Tri-Pivot Layout Structure (`image_611a8a.jpg` Split):**
  * **Main Frame (70% Width):**
    * **Destaque do Dia:** A massive hero element hosting the single most significant story of the day. The text summary is *synthesized programmatically* and attributed transparently to `FATO CENTRAL AGREGADO (XX FONTES)` instead of single publishers to preserve strict institutional neutrality.
    * **The Nuanced 3-Column Split Grid:** Located below the hero card, breaking out individual articles into "Viés Esquerda," "Viés Centro," and "Viés Direita."
    * **Inline Progress Bars:** Every individual sub-article card displays a horizontal progress slider indicating a precise, calculated coordinate score (e.g., `-78`, `0`, `+76`) mapping its specific position on the ideological spectrum rather than assigning a binary label.
  * **Telemetry & Cloud Sidebar (30% Width):**
    * **Meu Perfil de Viés:** Displays local user authentication state, historical reading metrics, and a segmented telemetry bar mapping their weekly political consumption habits. (See Section 6 — this component has direct implications for both the subscription model and the privacy architecture.)
    * **Tópicos em Alta:** Monospace list displaying keyword tags with the highest real-time media coverage frequencies.
    * **Subnoticiados (The Blindspot Engine):** Monospace list exposing factual, verified news items currently suffering from extreme coverage asymmetry (e.g., highly covered by one side, heavily omitted by the other).
* **Mobile Layout — Filter-Bubble-Safe Behavior:** On narrow viewports, the 3-column split must not stack vertically in a way that traps a reader inside one ideological column before reaching the others. MVP implementation: tabbed switcher (Esquerda / Centro / Direita) with equal visual weight given to all three tabs by default, rather than a default landing tab. A horizontal-swipe layout can be layered in post-MVP as a UX refinement, but is not a launch blocker.

---

## 3. Tech Stack & Classification Architecture

### 3.1 Bias Classification: LLM-based, not an in-house trained model

**Decision:** Ponto Cego uses the Claude API (Haiku-tier model for high-volume classification, Sonnet-tier for the higher-nuance "paste a link, get a breakdown" feature) to perform bias scoring, keyword extraction, and event clustering support — instead of training a custom in-house NLP/ML model from scratch.

This reverses the original "zero external LLM dependency" constraint. That trade-off was made deliberately, for these reasons:

* Building and continuously retraining a custom Portuguese-language political bias classifier requires a labeled training dataset, a dedicated ML engineer, and GPU training infrastructure — a cost and timeline that is not viable for a 1–2 person team.
* An LLM API call at inference time, especially with batch processing and prompt caching, is dramatically cheaper per-article than owning the training pipeline, and ships in weeks instead of months.

**What this means architecturally:**

* The classification pipeline sends article text (or RSS excerpt + metadata — see Section 3.3) to the Claude API with a fixed, versioned prompt/rubric defining the Brazilian left/center/right coordinate system.
* The rubric itself (the definitions of what counts as "Left," "Center," "Right," and how the -100 to +100 coordinate is derived) is owned and version-controlled by the admin team, not by the model. This preserves the "algorithmic transparency" principle from Section 1 — the *rules* are yours and auditable; the *model* is a tool applying them.
* Classification outputs are structured (JSON: coordinate score, confidence, keywords, suggested cluster) and stored in your own database — Claude is a processing step, not a data store.
* **Human-in-the-loop is mandatory, not optional.** The admin panel's manual override capability (Section 3.4) and the reader feedback loop (Section 6.2) are the actual mechanisms that keep classification trustworthy — the LLM is not treated as a black-box source of truth.

**Known trade-off to keep visible to users:** Ponto Cego's classification now depends on a third-party AI provider (Anthropic) rather than being fully self-hosted. This should be disclosed plainly in an "About/Methodology" page, consistent with the platform's transparency principle — the goal is to be honest about the mechanism, not to obscure it.

### 3.2 Real-Time Data Collection

* Lightweight scraping/ingestion workers (Go/Rust recommended for reliability at this team size, though a simpler stack is acceptable for MVP if it ships faster) poll RSS feeds and sitemaps of Brazilian news outlets.
* **Start with 15–30 curated major/regional/independent outlets for MVP**, not an exhaustive list. Expand the source list only after the pipeline, classification, and legal-safety practices (Section 3.3) are proven stable.

### 3.3 Content Model — RSS-Only, Redirect-First (Legal Safety Layer)

Ponto Cego does **not** host full article text or full-resolution images. This is a deliberate legal-risk-reduction decision under Brazilian Copyright Law (Lei 9.610/98) and is treated as a hard architectural constraint, not an editorial preference:

* **Text:** Server-side hard cap on excerpt length (e.g., ~15–20 words), applied in code regardless of how long the source's own RSS description happens to be. Never store or display a rewritten/paraphrased summary of a single source article — the `FATO CENTRAL AGREGADO` synthesis (Section 2) must describe the aggregate event across multiple sources, never substitute for one outlet's specific reporting.
* **Images:** Thumbnail-only, greyscale-filtered. Prefer hotlinking to the source's own image URL over re-hosting a copy; if re-hosting is needed for reliability, keep resolution low.
* **Always redirect to the original publisher's own article page** — never a stripped/ad-free mirror — before the reader reaches full content. Attribution (outlet name + link) must be visible pre-redirect.
* **Per-outlet compliance check:** robots.txt and any published syndication terms should be checked per source before onboarding it, not assumed uniformly across all outlets.
* A fast takedown/correction process must exist from day one — not because infringement is expected, but because responsiveness is now a meaningful factor under Brazil's evolving platform-liability standards.
* This is general engineering guidance, not legal advice — a Brazilian media/IP lawyer should review the actual implementation (excerpt length, image handling, per-outlet terms) before public launch.

### 3.4 Admin Panel & Controls

A secure, audited backend interface for the 1–2 person team, covering:

* **Manual publishing & structural override** — correcting misclassifications, merging/splitting event clusters, editing the `FATO CENTRAL AGREGADO` synthesis.
* **User management** — permissions, subscription/entitlement status.
* **Outlet Health Dashboard (new):** A visual status monitor per news source, e.g.:

  ```
  GLOBO         ● Online
  ESTADÃO       ● Online
  BRASIL 247    ▲ Degraded — 0 new articles in 6h
  CARTA CAPITAL ✕ Offline — fetch failing since 14:02
  ```

  Three states, not two:
  * **Online** — fetching and parsing new articles normally.
  * **Degraded** — feed is reachable but parsing 0 (or abnormally few) new articles vs. baseline; usually means the outlet changed its HTML/feed structure. This is the state that matters most in practice, since a silent parsing failure is much harder to notice manually than a hard outage.
  * **Offline** — feed unreachable entirely.

  Each outlet tracks: last successful fetch timestamp, last successful parse timestamp, article count in the trailing N hours. An alert threshold (e.g., "no new articles in 6h") should flag on the dashboard and, ideally, push a notification (email/Slack) to the maintainers rather than requiring a daily manual check.

* **Bias Correction Queue (new):** Feeds from the reader Like/Dislike signal (Section 6.2) land here as review items for a human — never as a direct, automatic retraining input. This avoids the classification system being gamed by coordinated brigading.
* **Dynamic classification rubric management:** Since Brazilian political vocabulary and alignments shift with electoral cycles, the Left/Center/Right rubric fed to the classification prompt must be editable by admins without a code deploy — versioned, with a change log.

---

## 4. Unknown Unknowns (Hidden Risks to Solve)

*Critical operational complexities that must be actively managed, not just designed around once:*

* **Mobile Filter-Bubble Effect:** Addressed via the tabbed mobile layout in Section 2. Revisit if user behavior data shows people aren't reaching all three columns.
* **Legal/Copyright Liabilities for Content Ingestion:** Mitigated architecturally via the RSS-only/redirect-first model (Section 3.3), but not eliminated — this remains the single highest external legal risk to the project and warrants a one-time professional legal review before launch, plus an ongoing "reach out to top sources for informal permission" practice.
* **Syndicated Wire Copy Inflation:** Many outlets republish identical wire content (Agência Brasil, Reuters, etc.) verbatim. The ingestion engine requires text-deduplication (e.g., MinHash LSH) to distinguish genuine multi-source coverage from copy-pasted wire syndication before calculating spectrum distribution — otherwise the system will misread wire republication as organic left/right consensus.
* **Classification Gaming via the Feedback Loop:** The Like/Dislike "is this correctly labeled" signal (Section 6.2) is valuable but exploitable — a coordinated group could mass-flag accurate labels they dislike. Feedback must route to human review, never auto-adjust scores directly.
* **Scraper Fragility as an Ongoing Cost, not a One-Time Build Cost:** News sites change markup without notice. At a 1–2 person team size, the Outlet Health Dashboard (Section 3.4) is the primary defense — but budget real, recurring maintenance time for this, indefinitely, not just at launch.

---

## 5. Unknown Knowns (Implicit Technical Assumptions)

* **Political Drift Re-calibration:** The classification rubric (now an LLM prompt/rubric rather than model weights) must still be continuously calibrated by admins as electoral cycles and party alignments shift. This is arguably *easier* to keep current now than a trained model would have been, since updating a prompt/rubric doesn't require retraining — but it still requires deliberate, scheduled admin review, not just ad hoc fixes.
* **Master Clustering Idempotency:** The backend still needs an event-clustering approach (LLM-assisted or otherwise) to group differently-worded headlines about the same real event into a single `EventID`. Design for graceful degradation — confidence scores and a manual-merge tool in the admin panel — rather than assuming 100% automatic accuracy.
* **State Tracking Without Infringing Privacy:** The "Meu Perfil de Viés" component implies tracking a user's reading/interaction history. Now that a subscription model exists (Section 6.1), there is a genuine tension between "keep this anonymized/client-side" (the original OpSec stance) and "this needs to be tied to a billing account" (a subscription requirement). Recommended approach: keep the billing/auth identity and the bias-profile telemetry in separate, only loosely linked data stores (e.g., a pseudonymous profile ID that maps to the billing account, rather than storing reading history directly against email/payment info) — decide this at schema design time, since separating it retroactively is expensive.

---

## 6. Monetization & Community Trust Mechanisms

### 6.1 Payment Model

* **No advertising**, by deliberate design — a "we are neutral and cannot be bought" brand promise is structurally undermined by an ad-revenue model, and the platform's monochrome/no-decorative-color visual identity makes conventional display ads visually awkward anyway.
* **PIX donation link** — low-friction, one-off support option; the accessible entry point for readers not ready to commit to a subscription.
* **Subscription tier** — the primary sustainable revenue path. Likely modeled on Ground News' approach: a free tier with a basic version of "Meu Perfil de Viés," and a paid tier unlocking deeper historical trend data, comparison to national reading averages, and exportable reports. Exact tier boundaries are intentionally left open pending real usage data post-launch — this should not be over-specified before launch.

### 6.2 Reader Feedback Loop — "Is this correctly labeled?"

* A Like/Dislike prompt appears when a reader clicks into an article, before the redirect to the source site, asking whether the bias label feels accurate.
* Stored as a lightweight signal (article ID, direction flag, timestamp, anonymized session identifier) — consistent with the platform's privacy-first stance; not tied to full user profiles.
* Feeds the admin Bias Correction Queue (Section 3.4) for human review — not an automatic retraining/scoring input (see the gaming risk in Section 4).
* Aggregate agreement (e.g., "73% of readers agreed with this label") is a strong candidate for public display directly on the article card — reinforces the platform's transparency positioning and gives the feedback loop visible purpose beyond internal QA.
