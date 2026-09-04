import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../db';
import * as s from '../../db/schema';
import { isNull, like } from 'drizzle-orm';

import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';



import { runIdempotent } from '../../services/idempotency.service';

import * as H from './config-helpers';
import { getFuelConfig, getFuelPriceHistory, getEffectiveFuelPrice } from '../../services/config.service';
import { fuelConfigSchema, companyInfoSchema } from '@tingting/shared';
import { companyInfoFromSettings } from '../../services/company-info.service';
import { requestOrApplyGovernedConfigAction, governedConfigVersionFromUpdatedAt } from '../../services/price-config-governance.service';



const router = Router();
// Operational config routes (T3c split) — road-config, fuel-config,
// company-info, fuel-price-history endpoints, moved verbatim from
// routes/config.ts. Governance payloads built via ./config-helpers.

router.get('/road-config', asyncHandler(async (_req: Request, res: Response) => {
  const [row] = await db.select().from(s.roadConfig).limit(1);
  if (!row) return res.json(null);
  res.json(row);
}));

router.put('/road-config', asyncHandler(async (req: Request, res: Response) => {
  const requestedData = H.roadConfigGovernanceSchema.parse(req.body);
  const idempotencyKey = H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật cấu hình đường.');
  const expectedUpdatedAt = H.readExpectedUpdatedAt(req);
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.ROAD_CONFIG_UPDATE,
    idempotencyKey,
    payload: {
      body: requestedData,
      expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null,
    },
    createdBy: actor.userId,
    entityType: 'road-config',
    responseStatusCode: 201,
    create: async (tx) => {
      const [existing] = await tx.select().from(s.roadConfig).limit(1).for('update');
      H.assertOptionalVersion(
        existing?.updatedAt ?? null,
        expectedUpdatedAt,
        'Thiếu phiên bản cấu hình đường. Vui lòng tải lại trước khi cập nhật.',
      );
      const data = H.normalizeRoadConfigPayload(requestedData, existing ?? null);
      return (await requestOrApplyGovernedConfigAction({
        resource: H.GOVERNED_SINGLETON_RESOURCES.roadConfig,
        operation: existing ? 'UPDATE' : 'CREATE',
        subjectId: existing?.id ?? null,
        subjectKey: H.GOVERNED_SINGLETON_RESOURCES.roadConfig,
        originalVersion: H.governedConfigVersion(existing ?? null),
        beforeRow: existing ?? null,
        afterData: data,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      })).action;
    },
  });
  res.status(replayed ? 200 : 201).json({ ...result, replayed });
}));

// Fuel config — singleton GET/PUT
router.get('/fuel-config', asyncHandler(async (_req: Request, res: Response) => {
  const row = await getFuelConfig();
  if (!row) return res.json(null);
  res.json(row);
}));

router.put('/fuel-config', asyncHandler(async (req: Request, res: Response) => {
  const data = fuelConfigSchema.parse(req.body);
  const idempotencyKey = H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật cấu hình nhiên liệu.');
  const expectedUpdatedAt = H.readExpectedUpdatedAt(req);
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.FUEL_CONFIG_UPDATE,
    idempotencyKey,
    payload: { body: data, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
    createdBy: actor.userId,
    entityType: 'fuel-config',
    responseStatusCode: 201,
    create: async (tx) => {
      const [existing] = await tx.select().from(s.fuelConfig).where(isNull(s.fuelConfig.deletedAt)).limit(1).for('update');
      H.assertOptionalVersion(
        existing?.updatedAt ?? null,
        expectedUpdatedAt,
        'Thiếu phiên bản cấu hình nhiên liệu. Vui lòng tải lại trước khi cập nhật.',
      );
      return (await requestOrApplyGovernedConfigAction({
        resource: H.GOVERNED_SINGLETON_RESOURCES.fuelConfig,
        operation: existing ? 'UPDATE' : 'CREATE',
        subjectId: existing?.id ?? null,
        subjectKey: H.GOVERNED_SINGLETON_RESOURCES.fuelConfig,
        originalVersion: H.governedConfigVersion(existing ?? null),
        beforeRow: existing ?? null,
        afterData: data,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      })).action;
    },
  });
  res.status(replayed ? 200 : 201).json({ ...result, replayed });
}));

// Company info — singleton stored as app_settings key/value rows
router.get('/company-info', asyncHandler(async (_req: Request, res: Response) => {
  // Only the company.* rows are ever relevant; don't load unrelated app_settings.
  const rows = await db.select().from(s.appSettings).where(like(s.appSettings.key, 'company.%'));
  res.json({ ...companyInfoFromSettings(rows), updatedAt: await H.getCompanyInfoUpdatedAt() });
}));

router.put('/company-info', asyncHandler(async (req: Request, res: Response) => {
  const candidate = req.body as Record<string, unknown>;
  const data = companyInfoSchema.parse({
    ...candidate,
    shortName: typeof candidate.shortName === 'string' && candidate.shortName.trim()
      ? candidate.shortName
      : candidate.name,
  });
  const idempotencyKey = H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật thông tin công ty.');
  const expectedUpdatedAt = H.readExpectedUpdatedAt(req);
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.COMPANY_INFO_UPDATE,
    idempotencyKey,
    payload: { body: data, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
    createdBy: actor.userId,
    entityType: 'app-settings',
    responseStatusCode: 201,
    create: async (tx) => {
      const current = await H.getCompanyInfoGovernedState(tx);
      H.assertOptionalVersion(
        current?.updatedAt ?? null,
        expectedUpdatedAt,
        'Thiếu phiên bản thông tin công ty. Vui lòng tải lại trước khi cập nhật.',
      );
      return (await requestOrApplyGovernedConfigAction({
        resource: H.GOVERNED_SINGLETON_RESOURCES.companyInfo,
        operation: current ? 'UPDATE' : 'CREATE',
        subjectId: null,
        subjectKey: H.GOVERNED_SINGLETON_RESOURCES.companyInfo,
        originalVersion: current?.updatedAt ? governedConfigVersionFromUpdatedAt(current.updatedAt) : 0,
        beforeRow: current,
        afterData: data,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      })).action;
    },
  });
  res.status(replayed ? 200 : 201).json({ ...result, replayed });
}));

// Fuel price history
router.get('/fuel-price-history', asyncHandler(async (_req: Request, res: Response) => {
  const history = await getFuelPriceHistory();
  res.json(history);
}));

router.get('/fuel-price-history/effective', asyncHandler(async (req: Request, res: Response) => {
  const dateStr = req.query.date as string;
  if (!dateStr) return res.status(400).json({ error: 'Tham số date là bắt buộc (YYYY-MM-DD)' });
  const price = await getEffectiveFuelPrice(new Date(dateStr));
  res.json({ price });
}));

export default router;
// Governance payloads built via ./config-helpers.
