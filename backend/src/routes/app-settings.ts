import { Router } from 'express';
import {
  appSettingsSchema,
  emailSettingsUpdateSchema,
  type EmailSettingsResponse,
} from '@tingting/shared';
import { asyncHandler } from '../middleware/asyncHandler';
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

appSettingsRouter.get('/email', asyncHandler(async (_req, res) => {
  const settings = await getEmailSettings();
  res.json(emailSettingsResponse(settings.resendApiKey));
}));

appSettingsRouter.put('/email', asyncHandler(async (req, res) => {
  const update = emailSettingsUpdateSchema.parse(req.body);
  const settings = await saveEmailSettings(update);
  res.json(emailSettingsResponse(settings.resendApiKey));
}));

appSettingsRouter.get('/', asyncHandler(async (_req, res) => res.json(await getAppSettings())));
appSettingsRouter.put('/', asyncHandler(async (req, res) => res.json(await saveAppSettings(appSettingsSchema.parse(req.body)))));
