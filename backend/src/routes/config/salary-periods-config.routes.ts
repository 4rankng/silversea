import { Router } from 'express';
import type { Request, Response } from 'express';
import * as s from '../../db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { ApiError } from '../../errors';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { runIdempotent } from '../../services/idempotency.service';
import * as H from './config-helpers';
import { getSalaryPeriodDefault, getSalaryPeriodDefaultFrom, getSalaryPeriodOverrides, resolveSalaryPeriodDateRange } from '../../services/salary-period.service';
import {
  approveSalaryPeriodClose,
  approveSalaryPeriodReopen,
  checkSalaryPeriodClose,
  checkSalaryPeriodReopen,
  getSalaryPeriodClose,
  listSalaryPeriodCloses,
  getSalaryPeriodReadiness,
  listSalaryPeriodExclusions,
  createSalaryPeriodExclusion,
  checkSalaryPeriodExclusion,
  approveSalaryPeriodExclusion,
  completeSalaryPeriodExclusionFollowup,
  requestSalaryPeriodClose,
  requestSalaryPeriodReopen,
} from '../../services/salary-period-close.service';
import { salaryPeriodSchema, salaryPeriodDefaultSchema, governanceActionVersionSchema } from '@tingting/shared';
import { requestOrApplyGovernedConfigAction } from '../../services/price-config-governance.service';

// Salary period config routes (T3c split) — the public resolve router and
// the admin defaults/overrides router, moved verbatim from routes/config.ts.

// ─── Salary Period Config ──────────────────────────────────────────────────────
// Two routers:
// 1. salaryPeriodsRouter — public resolve endpoint, mounted with casbinAuthz('salary')
//    so DRIVER can resolve period date ranges.
// 2. salaryPeriodsAdminRouter — admin CRUD (defaults, overrides), mounted with
//    casbinAuthz('config') so only ADMIN/MANAGER/ACCOUNTANT can manage them.

export const salaryPeriodsRouter = Router();

salaryPeriodsRouter.get('/resolve', asyncHandler(async (req: Request, res: Response) => {
  const month = parseInt(req.query.month as string, 10);
  const year = parseInt(req.query.year as string, 10);
  if (!month || !year || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Tháng và năm là bắt buộc (month 1-12, year >= 2000)' });
  }
  res.json(await resolveSalaryPeriodDateRange(month, year));
}));

export const salaryPeriodsAdminRouter = Router();

salaryPeriodsAdminRouter.get('/default', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getSalaryPeriodDefault());
}));

salaryPeriodsAdminRouter.put('/default', asyncHandler(async (req: Request, res: Response) => {
  const data = salaryPeriodDefaultSchema.parse(req.body);
  const idempotencyKey = H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật mặc định kỳ lương.');
  const expectedUpdatedAt = H.readExpectedUpdatedAt(req);
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_DEFAULT_UPDATE,
    idempotencyKey,
    payload: { body: data, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
    createdBy: actor.userId,
    entityType: 'salary-periods',
    responseStatusCode: 201,
    create: async (tx) => {
      const current = await getSalaryPeriodDefaultFrom(tx);
      H.assertOptionalVersion(
        current?.updatedAt ?? null,
        expectedUpdatedAt,
        'Thiếu phiên bản mặc định kỳ lương. Vui lòng tải lại trước khi cập nhật.',
      );
      return (await requestOrApplyGovernedConfigAction({
        resource: H.GOVERNED_SINGLETON_RESOURCES.salaryDefault,
        operation: current ? 'UPDATE' : 'CREATE',
        subjectId: current?.id ?? null,
        subjectKey: H.GOVERNED_SINGLETON_RESOURCES.salaryDefault,
        originalVersion: H.governedConfigVersion(current ?? null),
        beforeRow: current ?? null,
        afterData: data,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      })).action;
    },
  });
  res.status(replayed ? 200 : 201).json({ ...result, replayed });
}));

salaryPeriodsAdminRouter.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const items = await getSalaryPeriodOverrides();
  res.json({ items, total: items.length });
}));

salaryPeriodsAdminRouter.post('/', asyncHandler(async (req: Request, res: Response) => {
  const data = salaryPeriodSchema.parse(req.body);
  const idempotencyKey = H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi tạo kỳ lương.');
  const expectedUpdatedAt = H.readExpectedUpdatedAt(req);
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_OVERRIDE_CREATE,
    idempotencyKey,
    payload: { body: data, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
    createdBy: actor.userId,
    entityType: 'salary-periods',
    responseStatusCode: 201,
    create: async (tx) => {
      const [existing] = await tx.select()
        .from(s.salaryPeriods)
        .where(and(
          eq(s.salaryPeriods.month, data.month),
          eq(s.salaryPeriods.year, data.year),
          eq(s.salaryPeriods.isDefault, false),
          isNull(s.salaryPeriods.deletedAt),
        ))
        .limit(1)
        .for('update');
      H.assertOptionalVersion(
        existing?.updatedAt ?? null,
        expectedUpdatedAt,
        'Thiếu phiên bản kỳ lương. Vui lòng tải lại trước khi cập nhật.',
      );
      return (await requestOrApplyGovernedConfigAction({
        resource: H.GOVERNED_SINGLETON_RESOURCES.salaryOverride,
        operation: existing ? 'UPDATE' : 'CREATE',
        subjectId: existing?.id ?? null,
        subjectKey: H.salaryOverrideSubjectKey(data.month, data.year),
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

salaryPeriodsAdminRouter.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const data = salaryPeriodSchema.parse(req.body);
  const idempotencyKey = H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật kỳ lương.');
  const expectedUpdatedAt = H.requireExpectedUpdatedAt(
    req,
    'Thiếu phiên bản kỳ lương. Vui lòng tải lại trước khi cập nhật.',
  );
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_OVERRIDE_UPDATE,
    idempotencyKey,
    payload: { id, body: data, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: actor.userId,
    entityType: 'salary-periods',
    responseStatusCode: 201,
    create: async (tx) => {
      const [row] = await tx.select()
        .from(s.salaryPeriods)
        .where(and(
          eq(s.salaryPeriods.id, id),
          eq(s.salaryPeriods.isDefault, false),
          isNull(s.salaryPeriods.deletedAt),
        ))
        .limit(1)
        .for('update');
      if (!row) throw new ApiError(404, 'Không tìm thấy');
      H.assertOptionalVersion(row.updatedAt, expectedUpdatedAt, 'Thiếu phiên bản kỳ lương. Vui lòng tải lại trước khi cập nhật.');
      return (await requestOrApplyGovernedConfigAction({
        resource: H.GOVERNED_SINGLETON_RESOURCES.salaryOverride,
        operation: 'UPDATE',
        subjectId: id,
        subjectKey: H.salaryOverrideSubjectKey(data.month, data.year),
        originalVersion: H.governedConfigVersion(row),
        beforeRow: row,
        afterData: data,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      })).action;
    },
  });
  res.status(replayed ? 200 : 201).json({ ...result, replayed });
}));

salaryPeriodsAdminRouter.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const idempotencyKey = H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi xóa kỳ lương.');
  const expectedUpdatedAt = H.requireExpectedUpdatedAt(
    req,
    'Thiếu phiên bản kỳ lương. Vui lòng tải lại trước khi xóa.',
  );
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_OVERRIDE_DELETE,
    idempotencyKey,
    payload: { id, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: actor.userId,
    entityType: 'salary-periods',
    responseStatusCode: 201,
    create: async (tx) => {
      const [row] = await tx.select()
        .from(s.salaryPeriods)
        .where(and(
          eq(s.salaryPeriods.id, id),
          eq(s.salaryPeriods.isDefault, false),
          isNull(s.salaryPeriods.deletedAt),
        ))
        .limit(1)
        .for('update');
      if (!row) throw new ApiError(404, 'Không tìm thấy');
      H.assertOptionalVersion(row.updatedAt, expectedUpdatedAt, 'Thiếu phiên bản kỳ lương. Vui lòng tải lại trước khi xóa.');
      return (await requestOrApplyGovernedConfigAction({
        resource: H.GOVERNED_SINGLETON_RESOURCES.salaryOverride,
        operation: 'DELETE',
        subjectId: id,
        subjectKey: H.salaryOverrideSubjectKey(row.month ?? 0, row.year ?? 0),
        originalVersion: H.governedConfigVersion(row),
        beforeRow: row,
        afterData: null,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      })).action;
    },
  });
  res.status(replayed ? 200 : 201).json({ ...result, replayed });
}));

// M7.3 — salary period close / reopen. Idempotent; close posts ONE
// consolidated summary ledger entry; reopen posts the reversing entry.
// Both mount under salaryPeriodsAdminRouter (already gated by
// casbinAuthz('config') so only ADMIN/MANAGER/ACCOUNTANT reach them).
// The service re-checks the role for the actual operation (reopen is
// ADMIN/MANAGER only — stricter than close).
salaryPeriodsAdminRouter.get('/closes', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await listSalaryPeriodCloses());
}));

salaryPeriodsAdminRouter.get('/closes/:period', asyncHandler(async (req: Request, res: Response) => {
  const row = await getSalaryPeriodClose(req.params.period as string);
  if (!row) return res.status(404).json({ error: 'Kỳ này chưa chốt' });
  res.json(row);
}));

salaryPeriodsAdminRouter.get('/:period/readiness', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getSalaryPeriodReadiness(req.params.period as string));
}));

salaryPeriodsAdminRouter.get('/:period/exclusions', asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await listSalaryPeriodExclusions(req.params.period as string) });
}));

salaryPeriodsAdminRouter.post('/:period/exclusions', asyncHandler(async (req: Request, res: Response) => {
  const u = getUser(req);
  const body = req.body ?? {};
  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'Thiếu dữ liệu loại trừ kỳ lương');
  }
  const driverId = Number((body as { driverId?: unknown }).driverId);
  if (!Number.isInteger(driverId) || driverId < 1) {
    throw new ApiError(400, 'driverId không hợp lệ');
  }
  const reason = typeof (body as { reason?: unknown }).reason === 'string'
    ? (body as { reason: string }).reason.trim()
    : '';
  if (!reason) {
    throw new ApiError(400, 'Cần nhập lý do loại trừ');
  }
  const rawHandlingMode = typeof (body as { handlingMode?: unknown }).handlingMode === 'string'
    ? (body as { handlingMode: string }).handlingMode.trim()
    : '';
  if (rawHandlingMode !== 'SUPPLEMENTARY_PERIOD' && rawHandlingMode !== 'ADJUSTMENT') {
    throw new ApiError(400, 'handlingMode không hợp lệ');
  }
  const handlingMode = rawHandlingMode;
  const targetPeriod = typeof (body as { targetPeriod?: unknown }).targetPeriod === 'string'
    ? (body as { targetPeriod: string }).targetPeriod.trim()
    : null;
  const note = typeof (body as { note?: unknown }).note === 'string'
    ? (body as { note: string }).note
    : null;

  const period = req.params.period as string;
  const outcome = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_EXCLUSION_CREATE,
    idempotencyKey: H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi đề nghị loại trừ kỳ lương.'),
    payload: { period, driverId, reason, handlingMode, targetPeriod, note },
    createdBy: u.userId,
    entityType: 'governance_action',
    responseStatusCode: 201,
    create: (tx) => createSalaryPeriodExclusion({
      period,
      driverId,
      actorId: u.userId,
      actorRole: u.role,
      reason,
      handlingMode,
      targetPeriod,
      note,
      transaction: tx,
    }),
    getEntityId: (result) => result.actionId,
  });
  res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/exclusions/:actionId/check', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const u = getUser(req);
  const period = req.params.period as string;
  const expectedVersion = Number((req.body as { expectedVersion?: unknown } | undefined)?.expectedVersion);
  const note = typeof req.body?.note === 'string' ? req.body.note : null;
  const outcome = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_EXCLUSION_CHECK,
    idempotencyKey: H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi kiểm tra loại trừ kỳ lương.'),
    payload: { period, actionId, expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : null, note },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => checkSalaryPeriodExclusion({
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : null,
      note,
      transaction: tx,
    }),
    getEntityId: (result) => result.actionId,
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/exclusions/:actionId/approve', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const u = getUser(req);
  const period = req.params.period as string;
  const expectedVersion = Number((req.body as { expectedVersion?: unknown } | undefined)?.expectedVersion);
  const outcome = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_EXCLUSION_APPROVE,
    idempotencyKey: H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi phê duyệt loại trừ kỳ lương.'),
    payload: { period, actionId, expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : null },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => approveSalaryPeriodExclusion({
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : null,
      transaction: tx,
    }),
    getEntityId: (result) => result.actionId,
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/exclusions/:actionId/complete-followup', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const u = getUser(req);
  const period = req.params.period as string;
  const outcome = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_EXCLUSION_FOLLOWUP_COMPLETE,
    idempotencyKey: H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi hoàn tất xử lý lương bổ sung.'),
    payload: { period, actionId },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => completeSalaryPeriodExclusionFollowup({
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      transaction: tx,
    }),
    getEntityId: (result) => result.actionId,
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/close', asyncHandler(async (req: Request, res: Response) => {
  const u = getUser(req);
  const period = req.params.period as string;
  const note = typeof req.body?.note === 'string' ? req.body.note : null;
  const outcome = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_CLOSE_REQUEST,
    idempotencyKey: H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi đề nghị chốt kỳ lương.'),
    payload: { period, note },
    createdBy: u.userId,
    entityType: 'governance_action',
    responseStatusCode: 201,
    create: (tx) => requestSalaryPeriodClose({
      period,
      actorId: u.userId,
      actorRole: u.role,
      reason: note,
      note,
      transaction: tx,
    }),
  });
  res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/close-actions/:actionId/check', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const input = governanceActionVersionSchema.parse(req.body);
  const u = getUser(req);
  const period = req.params.period as string;
  const outcome = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_CLOSE_CHECK,
    idempotencyKey: H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi kiểm tra đề nghị chốt kỳ lương.'),
    payload: { period, actionId, expectedVersion: input.expectedVersion },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => checkSalaryPeriodClose({
      period,
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: input.expectedVersion,
      transaction: tx,
    }),
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/close-actions/:actionId/approve', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const input = governanceActionVersionSchema.parse(req.body);
  const u = getUser(req);
  const period = req.params.period as string;
  const outcome = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_CLOSE_APPROVE,
    idempotencyKey: H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi phê duyệt chốt kỳ lương.'),
    payload: { period, actionId, expectedVersion: input.expectedVersion },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => approveSalaryPeriodClose({
      period,
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: input.expectedVersion,
      transaction: tx,
    }),
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/reopen', asyncHandler(async (req: Request, res: Response) => {
  const u = getUser(req);
  const expectedVersion = Number((req.body as { expectedVersion?: unknown } | undefined)?.expectedVersion);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
  const note = typeof req.body?.note === 'string' ? req.body.note : null;
  const period = req.params.period as string;
  const normalizedVersion = Number.isInteger(expectedVersion) ? expectedVersion : 0;
  const outcome = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_REOPEN_REQUEST,
    idempotencyKey: H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi đề nghị mở lại kỳ lương.'),
    payload: { period, expectedVersion: normalizedVersion, reason, note },
    createdBy: u.userId,
    entityType: 'governance_action',
    responseStatusCode: 201,
    create: (tx) => requestSalaryPeriodReopen({
      period,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: normalizedVersion,
      reason,
      note,
      transaction: tx,
    }),
  });
  res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/reopen-actions/:actionId/check', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const input = governanceActionVersionSchema.parse(req.body);
  const u = getUser(req);
  const period = req.params.period as string;
  const outcome = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_REOPEN_CHECK,
    idempotencyKey: H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi kiểm tra đề nghị mở lại kỳ lương.'),
    payload: { period, actionId, expectedVersion: input.expectedVersion },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => checkSalaryPeriodReopen({
      period,
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: input.expectedVersion,
      transaction: tx,
    }),
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/reopen-actions/:actionId/approve', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const input = governanceActionVersionSchema.parse(req.body);
  const u = getUser(req);
  const period = req.params.period as string;
  const outcome = await runIdempotent({
    endpoint: H.CONFIG_COMMANDS.SALARY_REOPEN_APPROVE,
    idempotencyKey: H.requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi phê duyệt mở lại kỳ lương.'),
    payload: { period, actionId, expectedVersion: input.expectedVersion },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => approveSalaryPeriodReopen({
      period,
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: input.expectedVersion,
      transaction: tx,
    }),
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
}));

// ─── Audit logs (mounted separately with audit_logs Casbin resource) ─────────
