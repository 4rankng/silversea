-- A4 telemetry: navigate-compliance columns on agent_turn_metrics.
-- Idempotent (IF NOT EXISTS) so a re-apply after a journal desync can't fail on
-- "column already exists" — see memory drizzle-migrate-timestamp-not-hash +
-- service-fee-backfill-applied-prod (prod migration fragility).
ALTER TABLE "agent_turn_metrics" ADD COLUMN IF NOT EXISTS "navigate_directive_emitted" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "agent_turn_metrics" ADD COLUMN IF NOT EXISTS "guardrail_fired" boolean DEFAULT false;
