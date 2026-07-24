-- Browser-measured wait time: user presses send -> assistant response is shown.
-- Backend latency_user_perceived_ms is still kept for old rows and server-side
-- breakdowns; dashboard rollups prefer this client value when present.
ALTER TABLE "agent_turn_metrics"
  ADD COLUMN IF NOT EXISTS "latency_client_wait_ms" integer;
