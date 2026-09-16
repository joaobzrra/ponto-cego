CREATE TABLE "admin_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"outlet_id" integer NOT NULL,
	"type" text NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"recovery_emailed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"outlet_id" integer NOT NULL,
	"guid" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thumbnail_path" text,
	"low_confidence_input" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'published' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"admin_id" integer,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"outlet_id" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"http_status" integer,
	"not_modified" boolean DEFAULT false NOT NULL,
	"fetch_ok" boolean DEFAULT false NOT NULL,
	"parse_ok" boolean DEFAULT false NOT NULL,
	"articles_seen" integer DEFAULT 0 NOT NULL,
	"articles_new" integer DEFAULT 0 NOT NULL,
	"error_text" text,
	"snapshot_id" integer
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"email" text NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"feed_urls" jsonb NOT NULL,
	"fetch_interval_minutes" integer DEFAULT 10 NOT NULL,
	"parser_profile" text DEFAULT 'rss' NOT NULL,
	"compliance_status" text DEFAULT 'pending' NOT NULL,
	"compliance_notes" text,
	"onboarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"http_etag" text,
	"http_last_modified" text,
	CONSTRAINT "outlets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "raw_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"outlet_id" integer NOT NULL,
	"kind" text NOT NULL,
	"file_path" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"byte_size" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_runs" ADD CONSTRAINT "fetch_runs_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_snapshots" ADD CONSTRAINT "raw_snapshots_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_ix" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "alerts_outlet_ix" ON "alerts" USING btree ("outlet_id","triggered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_outlet_guid_ux" ON "articles" USING btree ("outlet_id","guid");--> statement-breakpoint
CREATE INDEX "articles_published_at_ix" ON "articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "articles_outlet_fetched_ix" ON "articles" USING btree ("outlet_id","fetched_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_ix" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "fetch_runs_outlet_started_ix" ON "fetch_runs" USING btree ("outlet_id","started_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_ix" ON "login_attempts" USING btree ("ip","attempted_at");--> statement-breakpoint
CREATE INDEX "raw_snapshots_outlet_fetched_ix" ON "raw_snapshots" USING btree ("outlet_id","fetched_at");