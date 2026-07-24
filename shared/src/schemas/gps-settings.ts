import { z } from 'zod';

/**
 * ADMIN-only Bách Khoa GPS credentials.
 *
 * The password is write-only: GET returns only a masked preview and whether a
 * password exists. Omitting `password` on PUT preserves the stored value.
 */
export const gpsSettingsUpdateSchema = z.object({
  username: z.string().trim().min(1, 'Vui lòng nhập tên đăng nhập Bách Khoa'),
  password: z.string()
    .refine((value) => value.trim().length > 0, 'Mật khẩu không được để trống')
    .optional(),
});

export type GpsSettingsUpdate = z.infer<typeof gpsSettingsUpdateSchema>;

export interface GpsSettingsResponse {
  username: string;
  passwordSet: boolean;
  passwordMasked: string;
}

export const GPS_SETTINGS_PATHS = {
  base: '/admin/gps-settings',
} as const;
