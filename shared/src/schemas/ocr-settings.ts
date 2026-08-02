import { z } from 'zod';

/**
 * ADMIN-only OCR runtime settings.
 *
 * Provider keys are write-only: GET returns only masked previews plus whether
 * each provider is configured.
 */
export const ocrSettingsUpdateSchema = z.object({
  enabled: z.boolean(),
  openrouterApiKey: z.string()
    .refine((value) => value.trim().length > 0, 'OpenRouter API key không được để trống')
    .optional(),
  geminiApiKey: z.string()
    .refine((value) => value.trim().length > 0, 'Gemini API key không được để trống')
    .optional(),
});

export type OcrSettingsUpdate = z.infer<typeof ocrSettingsUpdateSchema>;

export interface OcrSettingsResponse {
  enabled: boolean;
  openrouterKeySet: boolean;
  openrouterKeyMasked: string;
  geminiKeySet: boolean;
  geminiKeyMasked: string;
  updatedAt: string | null;
}

export const OCR_SETTINGS_PATHS = {
  base: '/admin/ocr-settings',
} as const;
