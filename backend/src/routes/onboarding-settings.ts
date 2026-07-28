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
} from '../services/onboarding-settings.service';
import type { OnboardingSettingsResponse } from '@tingting/shared';
import {
  getAppSettingsUpdatedAt,
  setTutorialEnabledInTx,
} from '../services/app-settings.service';
import { ApiError } from '../errors';
import { resolveIdempotencyKey, runIdempotent } from '../services/idempotency.service';

export const onboardingSettingsRouter = Router();
const ONBOARDING_SETTINGS_COMMAND = 'admin.onboarding-settings.update';

const updateSchema = z.object({
  tutorialEnabled: z.boolean(),
});

function requireIdempotencyKey(req: Request): string {
  const key = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: req.body?._requestId,
  });
  if (!key) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc khi cập nhật onboarding.');
  }
  return key;
}

function parseExpectedUpdatedAt(req: Request): Date | null {
  const raw = req.header('If-Unmodified-Since')?.trim();
  if (!raw) return null;
  const expected = new Date(raw);
  if (Number.isNaN(expected.getTime())) {
    throw new ApiError(400, 'Phiên bản dữ liệu không hợp lệ.');
  }
  return expected;
}

/** GET /api/admin/onboarding-settings */
onboardingSettingsRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const tutorialEnabled = await getOnboardingEnabled();
    const body: OnboardingSettingsResponse & { updatedAt: string | null } = {
      tutorialEnabled,
      updatedAt: await getAppSettingsUpdatedAt(),
    };
    res.json(body);
  }),
);

/** PUT /api/admin/onboarding-settings — flips the master switch. */
onboardingSettingsRouter.put(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const data = updateSchema.parse(req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    const expectedUpdatedAt = parseExpectedUpdatedAt(req);
    const { result, replayed } = await runIdempotent({
      endpoint: ONBOARDING_SETTINGS_COMMAND,
      idempotencyKey,
      payload: { body: data, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
      createdBy: req.user?.userId ?? null,
      entityType: 'app-settings',
      create: async (tx) => {
        const currentUpdatedAt = await getAppSettingsUpdatedAt(tx);
        if (currentUpdatedAt) {
          if (!expectedUpdatedAt) {
            throw new ApiError(428, 'Thiếu phiên bản onboarding. Vui lòng tải lại trước khi cập nhật.');
          }
          if (new Date(currentUpdatedAt).getTime() !== expectedUpdatedAt.getTime()) {
            throw new ApiError(409, 'Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.');
          }
        }
        const saved = await setTutorialEnabledInTx(tx, data.tutorialEnabled);
        const body: OnboardingSettingsResponse & { updatedAt: string } = {
          tutorialEnabled: saved.tutorialEnabled,
          updatedAt: saved.updatedAt,
        };
        return body;
      },
    });
    res.json({ ...result, replayed });
  }),
);
