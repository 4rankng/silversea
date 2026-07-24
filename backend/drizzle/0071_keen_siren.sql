-- Agent chat tables (agent_conversations + agent_messages).
--
-- Idempotent (2026-06-25): CREATE TABLE / ADD CONSTRAINT / CREATE INDEX lacked
-- IF NOT EXISTS, which blocked drizzle re-runs after a hash desync. Guarded so
-- it creates the tables on envs where they're absent (prod) and no-ops where they
-- already exist (dev/vantai). Constraint/index guards also cover the case where a
-- table exists but its FK/index was missed by a prior partial run.

CREATE TABLE IF NOT EXISTS "agent_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"role" "role" NOT NULL,
	"title" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" varchar(16) NOT NULL,
	"content" text,
	"response" jsonb,
	"tool_trace" jsonb,
	"directives" jsonb,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_conversations_user_id_users_id_fk') THEN
    ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_messages_conversation_id_agent_conversations_id_fk') THEN
    ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_conversations_user_updated_idx" ON "agent_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_messages_conversation_idx" ON "agent_messages" USING btree ("conversation_id");
