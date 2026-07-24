-- 0104_parallel_guardian.sql (P0 Instrumentation)
-- Adds latency_first_token_ms (TTFT) and intent_bucket to agent_turn_metrics.
--
-- NOTE: drizzle-kit generate also emitted a `CREATE TABLE faq_entries` because
-- that table was applied manually (0104_faq_knowledge_base.sql) outside the
-- drizzle journal, so the snapshot never recorded it. That CREATE is REMOVED
-- here — the table already exists in every environment. Only the two new
-- agent_turn_metrics columns are real schema drift.

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
