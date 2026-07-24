import { Router } from 'express';
import { appSettingsSchema } from '@tingting/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { getAppSettings, saveAppSettings } from '../services/app-settings.service';

export const appSettingsRouter = Router();
appSettingsRouter.get('/', asyncHandler(async (_req, res) => res.json(await getAppSettings())));
appSettingsRouter.put('/', asyncHandler(async (req, res) => res.json(await saveAppSettings(appSettingsSchema.parse(req.body)))));
