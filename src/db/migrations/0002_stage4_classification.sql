CREATE TABLE "calibration_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" bigint,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"expected_band" text NOT NULL,
	"notes" text,
	"added_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rubric_version" integer,
	"model_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"total" integer DEFAULT 0 NOT NULL,
	"agreed" integer DEFAULT 0 NOT NULL,
	"nc_total" integer DEFAULT 0 NOT NULL,
	"nc_agreed" integer DEFAULT 0 NOT NULL,
	"fetch_failed" integer DEFAULT 0 NOT NULL,
	"results" jsonb,
	"triggered_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_text" text
);
--> statement-breakpoint
CREATE TABLE "llm_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_batch_id" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"model_id" text NOT NULL,
	"rubric_version" integer NOT NULL,
	"article_count" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"estimated_usd" real DEFAULT 0 NOT NULL,
	"error_text" text
);
--> statement-breakpoint
CREATE TABLE "rubrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"change_note" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	CONSTRAINT "rubrics_version_unique" UNIQUE("version")
);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "band" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "band_confidence" real;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "keywords" jsonb;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "classify_reason" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "rubric_version" integer;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "classified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "classify_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "classify_batch_id" integer;--> statement-breakpoint
ALTER TABLE "calibration_articles" ADD CONSTRAINT "calibration_articles_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_articles" ADD CONSTRAINT "calibration_articles_added_by_admin_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_runs" ADD CONSTRAINT "calibration_runs_triggered_by_admin_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_batches_submitted_ix" ON "llm_batches" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "articles_classify_status_ix" ON "articles" USING btree ("classify_status");--> statement-breakpoint
CREATE INDEX "articles_band_ix" ON "articles" USING btree ("band");