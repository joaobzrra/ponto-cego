CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"type" text NOT NULL,
	"path" text,
	"article_id" bigint,
	"outlet_id" integer,
	"band" text,
	"referrer_host" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"query" text,
	"result_count" integer,
	"device" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"type" text NOT NULL,
	"dim" text NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"sessions" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_created_ix" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "events_type_created_ix" ON "events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "events_article_ix" ON "events" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "events_session_ix" ON "events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "events_daily_ux" ON "events_daily" USING btree ("day","type","dim","key");--> statement-breakpoint
CREATE INDEX "events_daily_day_ix" ON "events_daily" USING btree ("day");