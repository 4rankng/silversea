-- Per-turn chatbot performance metrics. 1:1 with agent_messages (assistant turns).
-- See agentTurnMetrics in schema.ts for the DUAL-LATENCY + ACK-EXCLUSION INVARIANT.
CREATE TABLE IF NOT EXISTS "agent_turn_metrics" (
  "message_id" integer PRIMARY KEY REFERENCES "agent_messages"("id"),
  "trace_id" text,
  "user_id" integer REFERENCES "users"("id"),
  "role" text,
  "conversation_id" integer REFERENCES "agent_conversations"("id"),
  "model" text,
  "latency_user_perceived_ms" integer,
  "latency_total_ms" integer,
  "latency_llm_ms" integer,
  "latency_tools_ms" integer,
  "latency_final_ms" integer,
  "latency_ack_ms" integer,
  "latency_persist_ms" integer,
  "react_iterations" integer,
  "tool_call_count" integer DEFAULT 0,
  "fallback_used" boolean DEFAULT false,
  "aborted" boolean DEFAULT false,
  "error_kind" text,
  "tokens_in" integer DEFAULT 0,
  "tokens_out" integer DEFAULT 0,
  "estimated_cost_vnd" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_turn_metrics_created_at_idx"
  ON "agent_turn_metrics" ("created_at");

CREATE INDEX IF NOT EXISTS "agent_turn_metrics_conversation_id_idx"
  ON "agent_turn_metrics" ("conversation_id");
