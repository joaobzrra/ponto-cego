-- Addendum 01 §A1: feeds become first-class rows (url + scope + per-feed
-- conditional-GET state); fetch_runs/health/alerts move to per-feed.
-- Hand-ordered: the DB is live mid-soak, every step backfills before it
-- constrains. Existing articles are backfilled feed_scope=geral per addendum.
CREATE TABLE "feeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"outlet_id" integer NOT NULL,
	"url" text NOT NULL,
	"scope" text DEFAULT 'geral' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"http_etag" text,
	"http_last_modified" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feeds_outlet_url_ux" ON "feeds" USING btree ("outlet_id","url");--> statement-breakpoint
-- One feeds row per existing outlet feed URL; carry over conditional-GET state
-- (valid: every outlet had exactly one URL so far).
INSERT INTO "feeds" ("outlet_id", "url", "http_etag", "http_last_modified")
SELECT o."id", u.url, o."http_etag", o."http_last_modified"
FROM "outlets" o, jsonb_array_elements_text(o."feed_urls") AS u(url);--> statement-breakpoint
-- Known politics-section feeds already in config get the politica scope.
UPDATE "feeds" SET "scope" = 'politica' WHERE "url" LIKE '%gazetadopovo.com.br/feed/rss/republica.xml';--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "feed_id" integer;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "feed_scope" text DEFAULT 'geral' NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_snapshots" ADD COLUMN "feed_id" integer;--> statement-breakpoint
ALTER TABLE "raw_snapshots" ADD CONSTRAINT "raw_snapshots_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "raw_snapshots" rs SET "feed_id" = (SELECT min(f."id") FROM "feeds" f WHERE f."outlet_id" = rs."outlet_id")
WHERE rs."kind" = 'feed_xml';--> statement-breakpoint
ALTER TABLE "fetch_runs" ADD COLUMN "feed_id" integer;--> statement-breakpoint
UPDATE "fetch_runs" fr SET "feed_id" = (SELECT min(f."id") FROM "feeds" f WHERE f."outlet_id" = fr."outlet_id");--> statement-breakpoint
ALTER TABLE "fetch_runs" ALTER COLUMN "feed_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fetch_runs" ADD CONSTRAINT "fetch_runs_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fetch_runs_feed_started_ix" ON "fetch_runs" USING btree ("feed_id","started_at");--> statement-breakpoint
ALTER TABLE "outlets" DROP COLUMN "feed_urls";--> statement-breakpoint
ALTER TABLE "outlets" DROP COLUMN "http_etag";--> statement-breakpoint
ALTER TABLE "outlets" DROP COLUMN "http_last_modified";
