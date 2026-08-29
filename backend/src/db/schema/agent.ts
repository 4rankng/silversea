// Extracted verbatim from the original schema.ts split; behavior identical.
// Regenerate via drizzle-kit against the barrel: db/schema/index.ts.

import {
  boolean, index, integer, jsonb, pgTable, serial, text, timestamp, varchar,
} from 'drizzle-orm/pg-core';
import { vectorColumn1536 } from './_shared';
import { roleEnum } from './_enums';
// ─── Agent (command-and-insight assistant) ─────────────────────────────────
// Conversation history for the bot. Persisted to Postgres (not Redis) for
// auditability — every user turn, assistant answer, and tool call is
// reconstructable. The bot has no identity of its own: every conversation is
// scoped to a user and the bot acts with that user's role (re-checked inside
// each tool). `role` is a snapshot of the user's role at conversation time, so
// a later role change never rewrites history.
export const agentConversations = pgTable('agent_conversations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  role: roleEnum('role').notNull(),
  title: varchar('title', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('agent_conversations_user_updated_idx').on(table.userId, table.updatedAt),
]);


// A turn in a conversation. `role` here is the message author ('user' |
// 'assistant'), distinct from the conversation's RBAC role above.
//   - content     : plain text (user message or an assistant 'text' answer)
//   - response    : the structured AgentResponse (insight_card | tutorial |
//                   directive | text) for assistant turns; null for user turns
//   - toolTrace   : jsonb array of { toolName, toolCallId, args, result, ok }
//                   — the full reasoning path, attached to the assistant turn
//                   that issued the calls. (The plan modelled these as separate
//                   columns; a jsonb trace is used instead because one turn
//                   fans out to N tool calls.)
//   - directives  : directives emitted this turn, denormalised for fast
//                   "what did the bot do" / audit queries
//   - tokens*     : cost accounting
export const agentMessages = pgTable('agent_messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull(),
  role: varchar('role', { length: 16 }).notNull(),
  content: text('content'),
  response: jsonb('response'),
  toolTrace: jsonb('tool_trace'),
  directives: jsonb('directives'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('agent_messages_conversation_idx').on(table.conversationId),
]);


// ─── FAQ knowledge base (chatbot pre-LLM fast lane) ─────────────────────────
// Seeded domain Q&A answered with ZERO LLM calls via a 4-stage cascade matcher
// (exact → rule → cosine similarity via pgvector → score/margin gate). The
// `embedding` column is populated by db/backfill-faq-embeddings.ts (OpenRouter
// text-embedding-3-small, 1536 dims). See drizzle/0104_faq_knowledge_base.sql
// for the full table + seed, and services/agent/faq-fast-lane.ts for matching.
export const faqEntries = pgTable('faq_entries', {
  id: serial('id').primaryKey(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  questionVariants: text('question_variants').array().notNull().default([]),
  requiredTerms: text('required_terms').array().notNull().default([]),
  forbiddenTerms: text('forbidden_terms').array().notNull().default([]),
  searchText: text('search_text').notNull().default(''),
  // pgvector column — JS representation is the literal string '[0.1,0.2,...]'.
  // NULL until the backfill script embeds the row. Vector ops go through raw SQL.
  embedding: vectorColumn1536('embedding'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});


// ─── Knowledge chunks (P2 doc-RAG over CONTEXT.md / ADRs / product docs) ────
// Generalizes the FAQ fast-lane retrieval to arbitrary product documentation.
// Each chunk is one semantic unit (heading/section/step) from a doc, embedded
// with the same text-embedding-3-small model. Retrieved via pgvector cosine
// similarity + metadata filtering. See services/agent/knowledge-retrieval.ts.
export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: serial('id').primaryKey(),
  // What kind of source: 'context' (CONTEXT.md), 'adr', 'doc', 'faq'.
  sourceType: text('source_type').notNull(),
  // Repo-relative path (e.g. 'CONTEXT.md', 'docs/adr/0001-...').
  sourcePath: text('source_path').notNull(),
  // Heading or section title within the source.
  heading: text('heading').notNull(),
  // The chunk content (one semantic unit, ≤500 chars).
  content: text('content').notNull(),
  // pgvector embedding (1536 dims, same model as FAQ). NULL until embedded.
  embedding: vectorColumn1536('embedding'),
  // Version watermark for stale-detection (hash of the source file at ingest).
  docVersion: text('doc_version'),
  // Vietnamese language code for the chunk.
  lang: text('lang').notNull().default('vi'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('knowledge_chunks_source_idx').on(table.sourceType, table.sourcePath),
]);

/**
 * Event-driven mobile GPS geotag for a photo submission (foundation module).
 *
 * Captures an accurate phone GPS fix at the moment a portal user submits a
 * photo (container/seal, port receipt, fuel pump, …) so the photo's claimed
 * location is provable — anti-fraud + compliance. This is the CLIENT-push
 * counterpart to the server-pulled Bách Khoa truck GPS (trip_gps_tracks /
 * vehicle_last_positions): those track the vehicle; this geotags a moment.
 *
 * Polymorphic over (entity_type, entity_id) so one table serves all three photo
 * tables — trip_photos (driver), trip_expense_photos (forwarder), expense_photos
 * (office) — plus future entities without further schema changes. One geotag per
 * entity: the service upserts on (entity_type, entity_id) so resubmits don't
 * duplicate (idempotency, M0X-HT-04). Ownership is resolved per-entity-type
 * inside the service (driver→own trip_photo, forwarder→own trip_expense_photo,
 * office→any) — not encoded here.
 *
 * Requirements: M08-05 / M09-05 / M12-03-03 (photo capture flows +
 * "thiếu vị trí phải cảnh báo"), M0X-HT-03 (audit trail via recordedBy).
 */
