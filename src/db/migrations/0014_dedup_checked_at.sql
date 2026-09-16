ALTER TABLE "articles" ADD COLUMN "dedup_checked_at" timestamp with time zone;--> statement-breakpoint
--> Only the dedup candidate window (72h) needs stamping: outside it an article
--> is never selected, so a NULL stamp there is harmless. Stamping the whole
--> table instead rewrites ~500MB of heap (1024-dim vectors) and does not finish
--> in reasonable time — do not "improve" this into a full-table UPDATE.
UPDATE "articles" SET "dedup_checked_at" = now()
  WHERE "embedding" IS NOT NULL AND "fetched_at" > now() - interval '72 hours';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_dedup_pending_ix" ON "articles" ("id") WHERE "dedup_checked_at" IS NULL;
