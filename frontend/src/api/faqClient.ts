// Typed API client for the ADMIN FAQ knowledge base endpoints. The path is the
// absolute `/admin/faq-entries` mount (NOT under the /api/config catch-all) —
// same pattern as llmSettingsClient and chatbotMetricsClient.
//
// Responses never include the `embedding` vector column; embedding status is
// surfaced via `FaqEntryMutationResponse.embeddingStatus` on create/update.
import { api } from '../lib/api';
import { FAQ_ADMIN_PATHS } from '@tingting/shared';
import type {
  FaqEntry,
  FaqEntryCreate,
  FaqEntryUpdate,
  FaqEntryMutationResponse,
} from '@tingting/shared';
import type { PaginatedResponse } from '@tingting/shared';

export const faqClient = {
  /** List FAQ entries. `includeInactive` surfaces deactivated rows for admin
   *  revival/audit. `search` applies unaccent-ILIKE on the canonical question. */
  list: (params?: { search?: string; includeInactive?: boolean; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.includeInactive) qs.set('includeInactive', 'true');
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return api.get<PaginatedResponse<FaqEntry>>(`${FAQ_ADMIN_PATHS.base}${query ? `?${query}` : ''}`);
  },

  get: (id: number) => api.get<FaqEntry>(`${FAQ_ADMIN_PATHS.base}/${id}`),

  /** Create a new FAQ entry. The backend re-embeds the row inline; the response
   *  carries `embeddingStatus` so the UI can warn when embedding failed. */
  create: (data: FaqEntryCreate) =>
    api.post<FaqEntryMutationResponse>(FAQ_ADMIN_PATHS.base, data),

  /** Partial update. Backend tone-strips terms if present and re-embeds. */
  update: (id: number, data: FaqEntryUpdate) =>
    api.put<FaqEntryMutationResponse>(`${FAQ_ADMIN_PATHS.base}/${id}`, data),

  /** Hard delete. */
  remove: (id: number) => api.delete<{ ok: boolean }>(`${FAQ_ADMIN_PATHS.base}/${id}`),
};
