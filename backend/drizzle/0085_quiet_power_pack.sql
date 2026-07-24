-- Idempotent re-issue of agent_turn_metrics + debit_note_templates.issuer_representative.
--
-- The original migration was a NON-idempotent duplicate: it re-created
-- "agent_turn_metrics" (already created by 0083_agent_turn_metrics) and
-- re-added "issuer_representative" (already added by
-- 0082_debit_note_issuer_representative), both WITHOUT IF NOT EXISTS. Any env
-- that already had 0082/0083 applied therefore failed here with
-- "relation already exists" / "column already exists"; drizzle-kit swallows the
-- message and just exits 1 after the spinner (see memory
-- drizzle-migrate-timestamp-not-hash + tingting-environment-ops "silent
-- migration failure"). Guarded to create only where absent and no-op otherwise,
-- mirroring the idempotency fix applied to 0071_keen_siren.
CREATE TABLE IF NOT EXISTS "agent_turn_metrics" (
	"message_id" integer PRIMARY KEY NOT NULL,
	"trace_id" text,
	"user_id" integer,
	"role" text,
	"conversation_id" integer,
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
--> statement-breakpoint
ALTER TABLE "debit_note_templates" ADD COLUMN IF NOT EXISTS "issuer_representative" varchar(100);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_turn_metrics_message_id_agent_messages_id_fk') THEN
    ALTER TABLE "agent_turn_metrics" ADD CONSTRAINT "agent_turn_metrics_message_id_agent_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."agent_messages"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_turn_metrics_user_id_users_id_fk') THEN
    ALTER TABLE "agent_turn_metrics" ADD CONSTRAINT "agent_turn_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_turn_metrics_conversation_id_agent_conversations_id_fk') THEN
    ALTER TABLE "agent_turn_metrics" ADD CONSTRAINT "agent_turn_metrics_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_turn_metrics_created_at_idx" ON "agent_turn_metrics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_turn_metrics_conversation_id_idx" ON "agent_turn_metrics" USING btree ("conversation_id");
