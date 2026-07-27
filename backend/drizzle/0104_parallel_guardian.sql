-- 0104_parallel_guardian.sql (P0 Instrumentation)
-- Adds latency_first_token_ms (TTFT) and intent_bucket to agent_turn_metrics.
--
-- The FAQ table originally shipped through an unjournaled manual migration.
-- Keep this idempotent definition in the journaled chain so a clean database
-- and a long-lived upgraded database converge on the same schema.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "faq_entries" (
  "id" serial PRIMARY KEY NOT NULL,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "question_variants" text[] DEFAULT '{}' NOT NULL,
  "required_terms" text[] DEFAULT '{}' NOT NULL,
  "forbidden_terms" text[] DEFAULT '{}' NOT NULL,
  "search_text" text DEFAULT '' NOT NULL,
  "embedding" vector(1536),
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "faq_entries_embedding_idx"
  ON "faq_entries" USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL AND "is_active" = true;--> statement-breakpoint

ALTER TABLE "agent_turn_metrics" ADD COLUMN "latency_first_token_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_turn_metrics" ADD COLUMN "intent_bucket" text;--> statement-breakpoint

-- Backfill: every existing row predates the router, so all were ReAct turns.
-- Mark them 'unknown' (NOT 'react_fallback') so they stay distinguishable from
-- post-router ReAct turns when analyzing intent distribution.
UPDATE "agent_turn_metrics" SET "intent_bucket" = 'unknown' WHERE "intent_bucket" IS NULL;--> statement-breakpoint

-- Covering index for dashboard intent-distribution queries. Low cardinality
-- (~6 buckets) so a btree is fine.
CREATE INDEX IF NOT EXISTS "agent_turn_metrics_intent_bucket_idx"
  ON "agent_turn_metrics" ("intent_bucket");
