// Pair salary surcharge settings (Cài đặt → Lương): ADMIN writes, financial
// roles read. Mirrors the road-allowance config surface (direct ADMIN CRUD,
// no maker-checker) — surcharges are operational wage config, not credit
// policy. Values are whole VND ≥ 0; 0 disables the pair surcharge.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Role } from '@tingting/shared';

import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from '../../services/idempotency.service';
import { ApiError } from '../../errors';
import {
  getPairSalarySettingsFrom,
  savePairSalarySettings,
} from '../../services/pair-salary-settings.service';

const pairSalarySettingsUpdateSchema = z.object({
  kepSurcharge: z.number().int('Phụ phí kẹp phải là số nguyên VND').min(0, 'Phụ phí kẹp không được âm'),
  ketHopSurcharge: z.number().int('Phụ phí kết hợp phải là số nguyên VND').min(0, 'Phụ phí kết hợp không được âm'),
});

export const pairSalarySettingsRouter = Router();

pairSalarySettingsRouter.get(
  '/pair-salary-settings',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await getPairSalarySettingsFrom());
  }),
);

pairSalarySettingsRouter.put(
  '/pair-salary-settings',
  requireRoles(Role.ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    const next = pairSalarySettingsUpdateSchema.parse(req.body);
    const user = getUser(req);
    const idempotencyKey = req.get('Idempotency-Key');
    if (!idempotencyKey) {
      throw new ApiError(400, 'Idempotency-Key là bắt buộc khi lưu phụ phí ghép chuyến.');
    }
    const { result, replayed } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.PAIR_SALARY_SETTINGS_UPDATE,
      idempotencyKey,
      payload: { actorId: user.userId, next },
      createdBy: user.userId,
      entityType: 'app_settings',
      responseStatusCode: 200,
      create: async (tx) => savePairSalarySettings(tx, next),
    });
    res.status(replayed ? 200 : 200).json({ ...result, replayed });
  }),
);
