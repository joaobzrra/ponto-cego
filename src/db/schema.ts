/**
 * Ponto Cego — Postgres schema (build stages 1–3).
 *
 * Hard rules from the spec that shape this schema:
 * - Articles NEVER store full text. Only a server-side capped excerpt (~20 words),
 *   metadata, and a re-hosted greyscale thumbnail path. Full text is fetched
 *   transiently at classification time (stage 4) and discarded.
 * - Stage 4 adds the classification columns (band incl. NC, rubric_version,
 *   model_id); clustering columns (cluster_id, embeddings) wait for stage 5.
 * - Split-identity rule (spec §7): when public reader accounts arrive (stage 6+),
 *   billing/auth identity and bias-profile telemetry MUST live in separate tables
 *   linked only by a pseudonymous profile ID — never store reading history against
 *   email/payment identity.
 * - audit_log is append-only: every admin mutation writes a row.
 */
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

export const outlets = pgTable("outlets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  fetchIntervalMinutes: integer("fetch_interval_minutes").notNull().default(10),
  /** Parser strategy id; "rss" for MVP, others as outlets demand them. */
  parserProfile: text("parser_profile").notNull().default("rss"),
  /** Compliance review before onboarding (spec §3.3): pending | approved | restricted. */
  complianceStatus: text("compliance_status").notNull().default("pending"),
  complianceNotes: text("compliance_notes"),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }).notNull().defaultNow(),
  enabled: boolean("enabled").notNull().default(true),
  /**
   * Ownership transparency ("quem é o dono"). Legal discipline: registry-grade
   * facts only, neutral wording, always with a public source link. Nothing is
   * displayed publicly until an admin flips ownerVerified after review.
   */
  owner: text("owner"),
  /**
   * familiar | corporativo | estatal | individual | independente | sindical |
   * partidário — factual category, no judgment. (Free text in the DB; the
   * admin form's select is the working vocabulary.)
   */
  ownerType: text("owner_type"),
  ownerSourceUrl: text("owner_source_url"),
  ownerVerified: boolean("owner_verified").notNull().default(false),
  /**
   * Generic public warning tag rendered as a red badge next to the outlet
   * name on every article surface (left of the bias bar). Factual provenance
   * labels only (first use: "Estatal Russa"), never editorial judgment.
   */
  warningLabel: text("warning_label"),
  /**
   * Per-outlet User-Agent override for feed/article fetches. Only for outlets
   * whose robots.txt allows crawling but whose WAF rejects the identifying
   * bot UA (e.g. Brasil Paralelo). Null = global polite UA from userAgent().
   */
  fetchUserAgent: text("fetch_user_agent"),
  /**
   * Relative audience-reach weight (Análise de Assunto: reach-weighted
   * prominence). AUTO-derived monthly from public traffic datasets via a
   * fixed published mapping (src/lib/reach.ts) — manual entry exists only as
   * an explicit, provenance-labeled override. Null = not configured;
   * exposure math only reports when at least one outlet has a weight.
   */
  reachWeight: real("reach_weight"),
  /** Where the weight came from: crux | tranco | manual. Null = never set. */
  reachSource: text("reach_source"),
  /** The source's raw popularity figure (CrUX rank bucket / Tranco rank). */
  reachRank: integer("reach_rank"),
  reachUpdatedAt: timestamp("reach_updated_at", { withTimezone: true }),
});

/** politica = section-specific political feed; geral = all-content firehose. */
export type FeedScope = "politica" | "geral";

/**
 * Named feeds per outlet (Addendum 01 §A1). Health baselines, conditional-GET
 * state and fetch_runs are all per feed — a política feed publishing 8/day and
 * a geral feed publishing 100/day must not share a Degraded threshold.
 * Feeds removed in the admin are disabled, never deleted (fetch_runs history
 * references them).
 */
export const feeds = pgTable(
  "feeds",
  {
    id: serial("id").primaryKey(),
    outletId: integer("outlet_id")
      .notNull()
      .references(() => outlets.id),
    url: text("url").notNull(),
    scope: text("scope").$type<FeedScope>().notNull().default("geral"),
    enabled: boolean("enabled").notNull().default(true),
    /** Conditional-GET state so we do not refetch unchanged feeds. */
    httpEtag: text("http_etag"),
    httpLastModified: text("http_last_modified"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("feeds_outlet_url_ux").on(t.outletId, t.url)],
);

export const articles = pgTable(
  "articles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    outletId: integer("outlet_id")
      .notNull()
      .references(() => outlets.id),
    /** GUID from the feed, or the canonical URL when the feed has no GUID. */
    guid: text("guid").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    /** Hard-capped in code (~20 words) before insert — never trust feed length. */
    excerpt: text("excerpt").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    /** Relative path under data/thumbs; re-hosted 300px greyscale JPEG. */
    thumbnailPath: text("thumbnail_path"),
    /** Set when ingestion had to fall back to degraded input (spec §3.1). */
    lowConfidenceInput: boolean("low_confidence_input").notNull().default(false),
    /** published | unpublished (takedown path — admin action, audited). */
    status: text("status").notNull().default("published"),
    /**
     * Scope of the feed the article arrived through (Addendum 01 §A1).
     * politica goes to classification by default; geral passes the NC gate
     * first (stage 4). Duplicated across feeds of one outlet → politica wins.
     */
    feedScope: text("feed_scope").$type<FeedScope>().notNull().default("geral"),
    /**
     * Classification (spec §3.1 + Addendum 01 §A2). Band is one of
     * E3|E2|E1|C|D1|D2|D3|NC — NC (Não Classificável) is a first-class
     * outcome, not an error state. C = political topic covered neutrally;
     * NC = not about politics at all. NC articles are excluded from all
     * spectrum math but stay fully visible in listings.
     * The full article text is fetched transiently for the API call and
     * NEVER stored — only this structured result is.
     */
    band: text("band").$type<Band>(),
    bandConfidence: real("band_confidence"),
    keywords: jsonb("keywords").$type<string[]>(),
    /** Short model-stated reason; kept for admin review, not article content. */
    classifyReason: text("classify_reason"),
    rubricVersion: integer("rubric_version"),
    modelId: text("model_id"),
    classifiedAt: timestamp("classified_at", { withTimezone: true }),
    /** pending | queued (in a batch) | classified | failed */
    classifyStatus: text("classify_status").notNull().default("pending"),
    classifyBatchId: integer("classify_batch_id"),
    /**
     * How many times the model was asked about THIS article and gave an
     * unusable answer. Provider outages (403/429/5xx) deliberately do not
     * count — those articles go back to `pending` untouched, because nothing
     * about the article was ever judged. Only at CLASSIFY_MAX_ATTEMPTS does
     * `failed` become terminal, and even then requeue-failed.ts can reset it.
     */
    classifyAttempts: integer("classify_attempts").notNull().default(0),
    /**
     * Stage 5 (spec §3.4): embedding of title+excerpt (bge-m3, 1024 dims,
     * local Ollama); null until the embed cycle runs (EMBED_ENABLED).
     */
    embedding: vector("embedding", { dimensions: 1024 }),
    /**
     * Wire-copy dedup (spec §3.4.2): points at the OLDER article this one
     * near-duplicates (cross-outlet syndication). Duplicates are excluded
     * from all spectrum math and public listings.
     */
    duplicateOf: bigint("duplicate_of", { mode: "number" }),
    /**
     * When wire-copy dedup last examined this article. The dedup search only
     * ever looks BACKWARD (`d.id < a.id`), so the set an article is compared
     * against is fixed the moment it arrives — one check is enough, and
     * re-checking the whole 72h window every cycle was ~8,300 HNSW searches
     * per cycle to find the handful of new ones (2026-07-21: ~10 min/cycle,
     * which serialized the worker tick and parked migrations behind it).
     */
    dedupCheckedAt: timestamp("dedup_checked_at", { withTimezone: true }),
    /** Event cluster membership (spec §3.4); null = not yet clustered. */
    clusterId: integer("cluster_id"),
    /** Fixed-taxonomy category, emitted by the classifier from rubric v3 on. */
    category: text("category"),
  },
  (t) => [
    uniqueIndex("articles_outlet_guid_ux").on(t.outletId, t.guid),
    index("articles_published_at_ix").on(t.publishedAt),
    index("articles_outlet_fetched_ix").on(t.outletId, t.fetchedAt),
    index("articles_classify_status_ix").on(t.classifyStatus),
    index("articles_band_ix").on(t.band),
    index("articles_cluster_ix").on(t.clusterId),
    /**
     * DROPPED 2026-07-26 — do NOT re-add without measuring first.
     *
     * It cost 349 MB (48% of the whole database) and `pg_stat_user_indexes`
     * showed `idx_scan = 0` over the DB's entire lifetime (`stats_reset` NULL).
     * EXPLAIN confirms why: every vector query here is pre-filtered to a narrow
     * candidate set — dedup to a 72h window, clustering to active clusters
     * <24h old — so the planner drives off `articles_cluster_ix` and then Sorts
     * a few hundred rows by distance. Brute force wins at that scale; HNSW
     * never gets chosen. (The old comment at cluster.ts:221 claiming the index
     * "drives the order by" was simply wrong.)
     *
     * Re-add it only for a query that scans the WHOLE corpus — e.g. the
     * deferred semantic layer for Análise de Assunto. Budget ~8 KB/row, and
     * note the rebuild is slow on the CPU-only VPS.
     */
    // index("articles_embedding_hnsw_ix").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/**
 * Event clusters (spec §3.4): one row per real-world event. Everything
 * user-visible in stages 5–7 (spectrum comparison, blindspot, synthesis)
 * operates on clusters. Admin merge/split is the permanent backstop.
 */
export const clusters = pgTable("clusters", {
  id: serial("id").primaryKey(),
  /** Working title — earliest member headline until an admin renames it. */
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** active | merged (absorbed into another cluster; kept for audit). */
  status: text("status").notNull().default("active"),
  mergedInto: integer("merged_into"),
});

/**
 * Destaque do Dia drafts (spec §2 v2: draft-by-AI, publish-by-human).
 * Generation is env-gated (SYNTHESIS_ENABLED); the public hero renders
 * ONLY status='approved' rows — never a draft.
 */
export const destaqueDrafts = pgTable("destaque_drafts", {
  id: serial("id").primaryKey(),
  clusterId: integer("cluster_id")
    .notNull()
    .references(() => clusters.id),
  draftTitle: text("draft_title").notNull(),
  draftSynthesis: text("draft_synthesis").notNull(),
  sourceCount: integer("source_count").notNull(),
  modelId: text("model_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** draft | approved | rejected */
  status: text("status").notNull().default("draft"),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

/** The 7 political bands + NC (Addendum 01 §A2). */
export const BANDS = ["E3", "E2", "E1", "C", "D1", "D2", "D3", "NC"] as const;
export type Band = (typeof BANDS)[number];

/** One row per feed per polling attempt — powers the Outlet Health Dashboard. */
export const fetchRuns = pgTable(
  "fetch_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    outletId: integer("outlet_id")
      .notNull()
      .references(() => outlets.id),
    feedId: integer("feed_id")
      .notNull()
      .references(() => feeds.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    httpStatus: integer("http_status"),
    /** True when the feed answered 304 Not Modified. */
    notModified: boolean("not_modified").notNull().default(false),
    /** Network-level success (reachable, HTTP OK or 304). */
    fetchOk: boolean("fetch_ok").notNull().default(false),
    /** Feed parsed into items without error. */
    parseOk: boolean("parse_ok").notNull().default(false),
    articlesSeen: integer("articles_seen").notNull().default(0),
    articlesNew: integer("articles_new").notNull().default(0),
    errorText: text("error_text"),
    snapshotId: integer("snapshot_id"),
  },
  (t) => [
    index("fetch_runs_outlet_started_ix").on(t.outletId, t.startedAt),
    index("fetch_runs_feed_started_ix").on(t.feedId, t.startedAt),
  ],
);

/** Raw fetched bytes kept 7 days per outlet for diff-debugging (spec §3.2). */
export const rawSnapshots = pgTable(
  "raw_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    outletId: integer("outlet_id")
      .notNull()
      .references(() => outlets.id),
    feedId: integer("feed_id")
      .references(() => feeds.id),
    /**
     * Always `feed_xml`. `article_html` was retired 2026-07-26 — it was
     * write-only and had grown to 2.6 GB (see poller.ts). Kept as free text
     * rather than an enum so old rows stay readable.
     */
    kind: text("kind").notNull(),
    /** Relative path under data/snapshots. `.gz` since 2026-07-26. */
    filePath: text("file_path").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    /** Size of the ORIGINAL bytes, not the compressed file on disk. */
    byteSize: integer("byte_size").notNull(),
  },
  (t) => [index("raw_snapshots_outlet_fetched_ix").on(t.outletId, t.fetchedAt)],
);

/**
 * Panel roles (2026-07-20). admin = everything incl. user management and all
 * mutations; moderator/patron = read access to the sections granted in
 * role_permissions. Every mutation server action stays admin-only.
 */
export const PANEL_ROLES = ["admin", "moderator", "patron"] as const;
export type PanelRole = (typeof PANEL_ROLES)[number];

export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<PanelRole>().notNull().default("admin"),
  /** Set at TOTP enrollment (first login). TOTP is mandatory after enrollment. */
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Section visibility per non-admin role — one row per (role, section) grant,
 * edited in /admin/usuarios. Admins always see every section (not stored);
 * the "usuarios" section is admin-only by construction and never grantable.
 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: serial("id").primaryKey(),
    role: text("role").$type<PanelRole>().notNull(),
    section: text("section").notNull(),
  },
  (t) => [uniqueIndex("role_permissions_role_section_ux").on(t.role, t.section)],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    /** sha256 hex of the session token; the raw token only lives in the cookie. */
    tokenHash: text("token_hash").primaryKey(),
    adminId: integer("admin_id")
      .notNull()
      .references(() => adminUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_sessions_expires_ix").on(t.expiresAt)],
);

/** Append-only. Every admin override, approval, unpublish, config change. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    adminId: integer("admin_id").references(() => adminUsers.id),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_created_ix").on(t.createdAt)],
);

/** Health alerting state — dedupes emails (one on trigger, one on recovery). */
export const alerts = pgTable(
  "alerts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    outletId: integer("outlet_id")
      .notNull()
      .references(() => outlets.id),
    /** Alerts are per feed (Addendum 01 §A1); null on rows predating feeds. */
    feedId: integer("feed_id").references(() => feeds.id),
    /** offline | degraded */
    type: text("type").notNull(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    recoveryEmailedAt: timestamp("recovery_emailed_at", { withTimezone: true }),
  },
  (t) => [index("alerts_outlet_ix").on(t.outletId, t.triggeredAt)],
);

/**
 * Versioned classification rubric (spec §3.1/§5): admin-editable without a
 * deploy, append-only versions with a change log. The active version's content
 * is the system prompt of every classification call; rubric_version is stored
 * on each classified article so results are auditable.
 */
export const rubrics = pgTable("rubrics", {
  id: serial("id").primaryKey(),
  version: integer("version").notNull().unique(),
  content: text("content").notNull(),
  changeNote: text("change_note").notNull(),
  createdBy: integer("created_by").references(() => adminUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  active: boolean("active").notNull().default(false),
});

/**
 * One row per Anthropic Message Batch (spec §4: batch endpoint, spend ceiling).
 * Token usage recorded from results feeds the per-day spend computation.
 */
export const llmBatches = pgTable(
  "llm_batches",
  {
    id: serial("id").primaryKey(),
    providerBatchId: text("provider_batch_id").notNull(),
    /** submitted | ended | failed */
    status: text("status").notNull().default("submitted"),
    modelId: text("model_id").notNull(),
    rubricVersion: integer("rubric_version").notNull(),
    articleCount: integer("article_count").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cacheCreationTokens: bigint("cache_creation_tokens", { mode: "number" }).notNull().default(0),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).notNull().default(0),
    estimatedUsd: real("estimated_usd").notNull().default(0),
    errorText: text("error_text"),
  },
  (t) => [index("llm_batches_submitted_ix").on(t.submittedAt)],
);

/**
 * Resumo do dia lines (spec 2026-09-03 §2a). ONE machine-written sentence
 * per cluster, generated once and reused; the only AI text that reaches a
 * public surface without human approval (owner ruling, ledger
 * CLM-briefing-machine-text-exempt-from-approval). Nothing here is ever
 * updated in place — a bad line is deleted and regenerated.
 */
export const briefingLines = pgTable("briefing_lines", {
  clusterId: integer("cluster_id").primaryKey(),
  line: text("line").notNull(),
  modelId: text("model_id").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Logo guard (2026-09-05). Outlets set og:image to their logo or a generic
 * card on pages without a photo, so the poller re-hosted the same image for
 * hundreds of articles and cluster cards showed "VEJA" instead of a photo.
 * One row per (outlet, md5 of the processed greyscale thumbnail); once the
 * same bytes have been seen THUMB_LOGO_THRESHOLD times for an outlet the
 * thumbnail is dropped. Never on `articles` — that table is hot.
 */
export const thumbnailHashes = pgTable(
  "thumbnail_hashes",
  {
    outletId: integer("outlet_id")
      .notNull()
      .references(() => outlets.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    seen: integer("seen").notNull().default(1),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.outletId, t.hash] })],
);

/** Newsletter list (spec 2026-09-04 §2). A row is never deleted on unsubscribe:
 * the state change is the audit trail and blocks third-party re-adds. */
export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    /** pending | confirmed | unsubscribed */
    status: text("status").notNull().default("pending"),
    /** 32 random bytes, hex — used in confirm and unsubscribe links. */
    token: text("token").notNull().unique(),
    /** home-box | newsletter-page */
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  },
  (t) => [index("newsletter_subscribers_status_ix").on(t.status)],
);

/** One row per BRT calendar date; the row is the send lock (spec §3). */
export const newsletterIssues = pgTable("newsletter_issues", {
  /** YYYY-MM-DD in America/Sao_Paulo. */
  date: text("date").primaryKey(),
  /** composed | sent | skipped | failed */
  status: text("status").notNull().default("composed"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  html: text("html").notNull(),
  composedAt: timestamp("composed_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  recipients: integer("recipients"),
  providerRef: text("provider_ref"),
  error: text("error"),
});

/**
 * Hand-labeled calibration set (spec §3.1): 50–100 articles spanning bands and
 * outlets, incl. 10–20 NC hard cases (Addendum 01 §A2). Article text is
 * re-fetched transiently at run time (never stored) — items whose URL rots are
 * reported as fetch failures by the runner.
 */
export const classificationObservations = pgTable(
  "classification_observations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    articleId: bigint("article_id", { mode: "number" })
      .notNull()
      .references(() => articles.id),
    batchId: integer("batch_id").references(() => llmBatches.id),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    rubricVersion: integer("rubric_version").notNull(),
    promptVersion: text("prompt_version").notNull().default("v1"),
    status: text("status").notNull().default("succeeded"),
    band: text("band").$type<Band>(),
    confidence: real("confidence"),
    keywords: jsonb("keywords").$type<string[]>(),
    category: text("category"),
    reason: text("reason"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    estimatedUsd: real("estimated_usd"),
    errorText: text("error_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
  },
  (t) => [
    index("classification_observations_article_ix").on(t.articleId, t.createdAt),
    index("classification_observations_model_ix").on(t.modelId, t.createdAt),
  ],
);

export const calibrationArticles = pgTable("calibration_articles", {
  id: serial("id").primaryKey(),
  articleId: bigint("article_id", { mode: "number" }).references(() => articles.id),
  url: text("url").notNull(),
  title: text("title").notNull(),
  expectedBand: text("expected_band").$type<Band>().notNull(),
  notes: text("notes"),
  addedBy: integer("added_by").references(() => adminUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Calibration runs (spec §5): re-run the set against the current rubric+model,
 * report agreement/drift — NC agreement separately (Addendum 01 §A2).
 * Created as pending by an admin action; executed by the worker.
 */
export const calibrationRuns = pgTable("calibration_runs", {
  id: serial("id").primaryKey(),
  /** pending | running | done | failed */
  status: text("status").notNull().default("pending"),
  rubricVersion: integer("rubric_version"),
  modelId: text("model_id"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  total: integer("total").notNull().default(0),
  agreed: integer("agreed").notNull().default(0),
  ncTotal: integer("nc_total").notNull().default(0),
  ncAgreed: integer("nc_agreed").notNull().default(0),
  fetchFailed: integer("fetch_failed").notNull().default(0),
  /** Per-item results: [{calibrationArticleId, expected, got, confidence}] */
  results: jsonb("results").$type<Array<Record<string, unknown>>>(),
  triggeredBy: integer("triggered_by").references(() => adminUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  errorText: text("error_text"),
});

/**
 * Reader feedback — "o rótulo está correto?" (spec §9). The ONLY
 * unauthenticated write on the whole site (spec §5): rate-limited per session
 * (one vote per article via the unique index + hourly cap in the action) and
 * stored LGPD-clean — article, direction, timestamp, anonymized session id.
 * Feeds the Bias Correction Queue for HUMAN review; never auto-adjusts bands.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    articleId: bigint("article_id", { mode: "number" })
      .notNull()
      .references(() => articles.id),
    /** agree | disagree */
    direction: text("direction").notNull(),
    /** On disagree: the band the reader thinks is right (E3..D3, never NC). */
    suggestedBand: text("suggested_band").$type<Band>(),
    /** Random cookie id — never an IP, never a user identity (spec §7). */
    sessionId: text("session_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: integer("reviewed_by").references(() => adminUsers.id),
  },
  (t) => [
    uniqueIndex("feedback_article_session_ux").on(t.articleId, t.sessionId),
    index("feedback_article_ix").on(t.articleId),
  ],
);

/**
 * First-party analytics events (2026-07-14, user decision: measure everything
 * pseudonymously, nothing sent to third parties — /privacidade discloses).
 * Split-identity rule (§7) applied: session_id is the anonymous pc_sess
 * cookie, NO IP, NO user-agent text (only a coarse device class + is_bot
 * computed at ingestion, UA discarded). Raw rows pruned at 90 days by the
 * worker retention job; long-term trends live in events_daily.
 */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Anonymous pc_sess cookie id — never an IP, never an identity (§7). */
    sessionId: text("session_id").notNull(),
    /** pageview | clickout | search | feedback */
    type: text("type").notNull(),
    /** Normalized path, query string stripped (utm extracted separately). */
    path: text("path"),
    articleId: bigint("article_id", { mode: "number" }).references(() => articles.id),
    outletId: integer("outlet_id").references(() => outlets.id),
    /** Denormalized at write so band engagement never needs a join. */
    band: text("band"),
    /** Referrer hostname only (external referrers; never full URLs). */
    referrerHost: text("referrer_host"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    /** Search: lowercased/trimmed query (≤80 chars). */
    query: text("query"),
    /** Search: result count — 0 flags gaps in coverage worth investigating. */
    resultCount: integer("result_count"),
    /** Coarse device class from the (discarded) UA: mobile | desktop. */
    device: text("device"),
    /** Crawler/preview-bot traffic, kept briefly for visibility, excluded from dashboards. */
    isBot: boolean("is_bot").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_created_ix").on(t.createdAt),
    index("events_type_created_ix").on(t.type, t.createdAt),
    index("events_article_ix").on(t.articleId),
    index("events_session_ix").on(t.sessionId, t.createdAt),
  ],
);

/**
 * Permanent daily rollups of events (the worker aggregates each finished day,
 * then raw rows age out at 90d). dim says what key means: path | outlet |
 * query | referrer | utm | band. sessions = distinct session_ids that day.
 */
export const eventsDaily = pgTable(
  "events_daily",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    day: date("day").notNull(),
    type: text("type").notNull(),
    dim: text("dim").notNull(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    sessions: integer("sessions").notNull(),
  },
  (t) => [
    uniqueIndex("events_daily_ux").on(t.day, t.type, t.dim, t.key),
    index("events_daily_day_ix").on(t.day),
  ],
);

/** Login rate limiting (per IP and per email); pruned by the retention job. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ip: text("ip").notNull(),
    email: text("email").notNull(),
    success: boolean("success").notNull().default(false),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_ip_ix").on(t.ip, t.attemptedAt)],
);
