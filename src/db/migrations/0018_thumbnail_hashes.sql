SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE "thumbnail_hashes" (
  "outlet_id" integer NOT NULL REFERENCES "outlets"("id") ON DELETE CASCADE,
  "hash" text NOT NULL,
  "seen" integer DEFAULT 1 NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "thumbnail_hashes_pk" PRIMARY KEY ("outlet_id", "hash")
);
