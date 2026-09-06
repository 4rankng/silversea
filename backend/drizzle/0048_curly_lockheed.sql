DROP TABLE "agent_conversations" CASCADE;--> statement-breakpoint
DROP TABLE "agent_messages" CASCADE;--> statement-breakpoint
DROP TABLE "faq_entries" CASCADE;--> statement-breakpoint
DROP TABLE "knowledge_chunks" CASCADE;--> statement-breakpoint
DELETE FROM app_settings WHERE setting_key LIKE 'llm.%' OR setting_key = 'app.bot_enabled';--> statement-breakpoint
DROP EXTENSION IF EXISTS vector;