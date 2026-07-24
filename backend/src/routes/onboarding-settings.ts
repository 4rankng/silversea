/**
 * Admin onboarding master-switch settings — turn the onboarding tutorial
 * (checklist panel + tours) on or off app-wide.
 *
 * RBAC: ADMIN-only (mirrors llm-settings — the `onboarding-settings` Casbin
 * resource has no policy row, only the ADMIN wildcard matches).
 * requireRoles(Role.ADMIN) at mount time is belt-and-suspenders.
 *
 * Storage: one app_settings row (`onboarding.tutorial_enabled`). The cached
 * read (services/onboarding-settings.service.ts) is invalidated after a write so
 * the next /auth/me reflects the change immediately.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import {
  getOnboardingEnabled,
  setOnboardingEnabled,
} from '../services/onboarding-settings.service';
import type { OnboardingSettingsResponse } from '@tingting/shared';

export const onboardingSettingsRouter = Router();

const updateSchema = z.object({
  tutorialEnabled: z.boolean(),
});

/** GET /api/admin/onboarding-settings */
onboardingSettingsRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const tutorialEnabled = await getOnboardingEnabled();
    const body: OnboardingSettingsResponse = { tutorialEnabled };
    res.json(body);
  }),
);

/** PUT /api/admin/onboarding-settings — flips the master switch. */
onboardingSettingsRouter.put(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const data = updateSchema.parse(req.body);
    await setOnboardingEnabled(data.tutorialEnabled);
    const body: OnboardingSettingsResponse = { tutorialEnabled: data.tutorialEnabled };
    res.json(body);
  }),
);
