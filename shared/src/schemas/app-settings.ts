import { z } from 'zod';

/** Runtime feature switches exposed in the Admin application-settings page. */
export const appSettingsSchema = z.object({
  botEnabled: z.boolean(),
  tutorialEnabled: z.boolean(),
  // Bách Khoa live GPS sync. When off, the live-fleet endpoint stops pulling
  // from the provider and the admin credentials are retained for easy re-enable.
  gpsEnabled: z.boolean(),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;
