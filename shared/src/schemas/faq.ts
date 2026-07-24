/**
 * FAQ knowledge base — shared contract for the admin CRUD API
 * (backend/src/routes/faq-admin.ts) and the admin management page
 * (frontend pages/config/FaqEntriesConfigPage.tsx).
 *
 * The `faq_entries` table backs the chatbot agent's pre-LLM fast lane
 * (services/agent/faq-fast-lane.ts): a 4-stage cascade (exact → rule → cosine
 * similarity via pgvector → score/margin gate) that answers seeded domain
 * questions with ZERO LLM calls. Admin-managed entries are (re)embedded on
 * every create/update so they become queryable immediately.
 *
 * IMPORTANT — diacritic rule for term arrays (mirrors the seed in
 * drizzle/0104_faq_knowledge_base.sql): `questionVariants` MAY keep Vietnamese
 * diacritics (normalized at match time), but `requiredTerms` and
 * `forbiddenTerms` MUST be stored TONE-STRIPPED (e.g. 'phat' not 'phạt') because
 * the matcher compares them against tone-stripped query tokens. The backend
 * route tone-strips these on save using the same normalizeText() helper the
 * matcher uses, so the admin can type either form — but the canonical stored
 * form is always tone-stripped.
 *
 * The `embedding` column (vector(1536)) is intentionally ABSENT from these
 * types — it is never sent to the client (keeps payloads small, avoids leaking
 * a 1536-float vector per row). Embedding status is surfaced separately.
 */
import { z } from 'zod';

/** Admin FAQ entry as returned by the API (no `embedding` column).
 *  `hasEmbedding` is a computed boolean (`embedding IS NOT NULL`) so the UI
 *  can show an accurate embedded/not-embedded badge without the 1536-float
 *  vector ever leaving the server. */
export interface FaqEntry {
  id: number;
  question: string;
  answer: string;
  questionVariants: string[];
  requiredTerms: string[];
  forbiddenTerms: string[];
  searchText: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  hasEmbedding: boolean;
}

/** POST /api/admin/faq-entries — create a new FAQ entry. */
export const faqEntryCreateSchema = z.object({
  question: z.string().min(1, 'Câu hỏi không được để trống'),
  answer: z.string().min(1, 'Câu trả lời không được để trống'),
  questionVariants: z.array(z.string()).default([]),
  requiredTerms: z.array(z.string()).default([]),
  forbiddenTerms: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export type FaqEntryCreate = z.infer<typeof faqEntryCreateSchema>;

/** PUT /api/admin/faq-entries/:id — partial update. */
export const faqEntryUpdateSchema = faqEntryCreateSchema.partial();
export type FaqEntryUpdate = z.infer<typeof faqEntryUpdateSchema>;

/** Embedding outcome for a create/update. Surfaced so the admin UI can warn
 *  when an entry was saved but could not be embedded (missing key / provider
 *  down). The fast lane abstains on NULL embeddings, so this is non-fatal. */
export type FaqEmbeddingStatus = 'embedded' | 'failed';

/** Response envelope for create/update — the saved entry plus embedding status. */
export interface FaqEntryMutationResponse {
  entry: FaqEntry;
  embeddingStatus: FaqEmbeddingStatus;
}

/** API path constants for the admin FAQ endpoints. */
export const FAQ_ADMIN_PATHS = {
  base: '/admin/faq-entries',
} as const;
