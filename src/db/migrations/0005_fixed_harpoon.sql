ALTER TABLE "outlets" ADD COLUMN "owner" text;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "owner_type" text;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "owner_source_url" text;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "owner_verified" boolean DEFAULT false NOT NULL;