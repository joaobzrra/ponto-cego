CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"merged_into" integer
);
--> statement-breakpoint
CREATE TABLE "destaque_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_id" integer NOT NULL,
	"draft_title" text NOT NULL,
	"draft_synthesis" text NOT NULL,
	"source_count" integer NOT NULL,
	"model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "duplicate_of" bigint;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "cluster_id" integer;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "destaque_drafts" ADD CONSTRAINT "destaque_drafts_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_cluster_ix" ON "articles" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "articles_embedding_hnsw_ix" ON "articles" USING hnsw ("embedding" vector_cosine_ops);