import { z } from 'zod';

/**
 * ADMIN-only Resend credential.
 *
 * The API key is write-only. GET/PUT responses expose only whether a key is
 * configured and a masked suffix. Omitting or blanking `resendApiKey` keeps
 * the stored value; `clearResendApiKey` explicitly removes it.
 */
export const emailSettingsUpdateSchema = z.object({
  resendApiKey: z.string().optional(),
  clearResendApiKey: z.boolean().optional(),
}).refine(
  (data) => !(data.clearResendApiKey && data.resendApiKey?.trim()),
  'Không thể vừa thay API key vừa xóa API key',
);

export type EmailSettingsUpdate = z.infer<typeof emailSettingsUpdateSchema>;

export interface EmailSettingsResponse {
  resendKeySet: boolean;
  resendKeyMasked: string;
}

export const EMAIL_SETTINGS_PATHS = {
  base: '/admin/app-settings/email',
} as const;
