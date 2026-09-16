ALTER TABLE "outlets" ADD COLUMN "reach_source" text;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "reach_rank" integer;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "reach_updated_at" timestamp with time zone;