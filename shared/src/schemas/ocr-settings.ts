import { z } from 'zod';

/**
 * ADMIN-only OCR settings.
 *
 * OCR runs exclusively on OpenRouter (Qwen chain, matching vantaiphucloc).
 * The provider key is
 * write-only: GET returns only a masked preview and whether the key exists.
 * Omitting or sending a blank key on PUT preserves the current value; the
 * explicit clear flag wipes it.
 */
export const ocrSettingsUpdateSchema = z.object({
  enabled: z.boolean(),
  openrouterApiKey: z.string().max(2048, 'OpenRouter API key quá dài').optional(),
  clearOpenRouterKey: z.boolean().optional(),
});

export type OcrSettingsUpdate = z.infer<typeof ocrSettingsUpdateSchema>;

export interface OcrSettingsResponse {
  enabled: boolean;
  openrouterKeySet: boolean;
  openrouterKeyMasked: string;
  /** Optimistic-concurrency token remembered by the API client. */
  updatedAt: string | null;
}

export const OCR_SETTINGS_PATHS = {
  base: '/admin/ocr-settings',
} as const;
