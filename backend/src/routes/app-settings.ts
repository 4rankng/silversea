import { Router } from 'express';
import { Role } from '@tingting/shared';
import {
  appSettingsSchema,
  emailSettingsUpdateSchema,
  type EmailSettingsResponse,
} from '@tingting/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireRoles } from '../middleware/casbin';
import { getAppSettings, saveAppSettings } from '../services/app-settings.service';
import { maskKey } from '../services/crypto';
import {
  getEmailSettings,
  saveEmailSettings,
} from '../services/email-settings.service';

export const appSettingsRouter = Router();

function emailSettingsResponse(resendApiKey: string): EmailSettingsResponse {
  return {
    resendKeySet: !!resendApiKey,
    resendKeyMasked: maskKey(resendApiKey),
  };
}

appSettingsRouter.get(
  '/email',
  requireRoles(Role.ADMIN),
  asyncHandler(async (_req, res) => {
    const settings = await getEmailSettings();
    res.json(emailSettingsResponse(settings.resendApiKey));
  }),
);

appSettingsRouter.put(
  '/email',
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const update = emailSettingsUpdateSchema.parse(req.body);
    const settings = await saveEmailSettings(update);
    res.json(emailSettingsResponse(settings.resendApiKey));
  }),
);

appSettingsRouter.get(
  '/',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (_req, res) => res.json(await getAppSettings())),
);
appSettingsRouter.put(
  '/',
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => res.json(await saveAppSettings(appSettingsSchema.parse(req.body)))),
);
