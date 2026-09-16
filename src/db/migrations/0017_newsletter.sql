SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE "newsletter_subscribers" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "token" text NOT NULL,
  "source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "confirmed_at" timestamp with time zone,
  "unsubscribed_at" timestamp with time zone,
  CONSTRAINT "newsletter_subscribers_email_unique" UNIQUE("email"),
  CONSTRAINT "newsletter_subscribers_token_unique" UNIQUE("token")
);
CREATE INDEX "newsletter_subscribers_status_ix" ON "newsletter_subscribers" ("status");

CREATE TABLE "newsletter_issues" (
  "date" text PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'composed' NOT NULL,
  "payload" jsonb NOT NULL,
  "html" text NOT NULL,
  "composed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "recipients" integer,
  "provider_ref" text,
  "error" text
);
