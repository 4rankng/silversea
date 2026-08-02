import { z } from 'zod';

/**
 * ADMIN-only OCR settings.
 *
 * OCR enablement is independent from chatbot LLM settings. Provider keys are
 * write-only: GET returns only masked previews and whether each key exists.
 * Omitting or sending a blank key on PUT preserves the current value; explicit
 * clear flags wipe a key.
 */
export const ocrSettingsUpdateSchema = z.object({
  enabled: z.boolean(),
  openrouterApiKey: z.string().max(2048, 'OpenRouter API key quá dài').optional(),
  geminiApiKey: z.string().max(2048, 'Gemini API key quá dài').optional(),
  clearOpenRouterKey: z.boolean().optional(),
  clearGeminiKey: z.boolean().optional(),
});

export type OcrSettingsUpdate = z.infer<typeof ocrSettingsUpdateSchema>;

export interface OcrSettingsResponse {
  enabled: boolean;
  openrouterKeySet: boolean;
  geminiKeySet: boolean;
  openrouterKeyMasked: string;
  geminiKeyMasked: string;
  /** Optimistic-concurrency token remembered by the API client. */
  updatedAt: string | null;
}

export const OCR_SETTINGS_PATHS = {
  base: '/admin/ocr-settings',
} as const;
