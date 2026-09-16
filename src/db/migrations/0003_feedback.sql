CREATE TABLE "feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"article_id" bigint NOT NULL,
	"direction" text NOT NULL,
	"session_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" integer
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_reviewed_by_admin_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_article_session_ux" ON "feedback" USING btree ("article_id","session_id");--> statement-breakpoint
CREATE INDEX "feedback_article_ix" ON "feedback" USING btree ("article_id");