SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE "classification_observations" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "article_id" bigint NOT NULL REFERENCES "articles"("id"),
  "batch_id" integer REFERENCES "llm_batches"("id"),
  "provider" text NOT NULL,
  "model_id" text NOT NULL,
  "rubric_version" integer NOT NULL,
  "prompt_version" text DEFAULT 'v1' NOT NULL,
  "status" text DEFAULT 'succeeded' NOT NULL,
  "band" text,
  "confidence" real,
  "keywords" jsonb,
  "category" text,
  "reason" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "latency_ms" integer,
  "estimated_usd" real,
  "error_text" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "activated_at" timestamp with time zone
);

CREATE INDEX "classification_observations_article_ix"
  ON "classification_observations" ("article_id", "created_at");
CREATE INDEX "classification_observations_model_ix"
  ON "classification_observations" ("model_id", "created_at");
