-- Análise de Assunto (subject analysis): trigram index so the subject matcher's
-- title ILIKE '%subject%' scan stays fast as the corpus grows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_title_trgm_ix" ON "articles" USING gin ("title" gin_trgm_ops);
