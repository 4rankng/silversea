import { z } from 'zod';

/** Runtime feature switches exposed in the Admin application-settings page. */
export const appSettingsSchema = z.object({
  botEnabled: z.boolean(),
  tutorialEnabled: z.boolean(),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;
