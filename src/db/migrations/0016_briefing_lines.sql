SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE "briefing_lines" (
  "cluster_id" integer PRIMARY KEY NOT NULL,
  "line" text NOT NULL,
  "model_id" text NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
