-- Migration 0087 owns this column; retain this generated journal entry as an
-- idempotent compatibility step for databases that skipped 0087.
ALTER TABLE "agent_turn_metrics" ADD COLUMN IF NOT EXISTS "latency_client_wait_ms" integer;
