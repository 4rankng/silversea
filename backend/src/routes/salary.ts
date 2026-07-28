import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireRoles } from '../middleware/casbin';
import { getUser } from '../middleware/auth';
import { governanceActionVersionSchema, Role } from '@tingting/shared';
import {
  computeSalary,
  batchUpsertWorkDays,
  getWorkDays,
  computeAllDriverSalaries,
} from '../services/attendance.service';
import {
  approveSalaryPeriodClose,
  approveSalaryPeriodReopen,
  checkSalaryPeriodClose,
  checkSalaryPeriodReopen,
  getSalaryPeriodLifecycle,
  issueSalaryPeriodPayslips,
  markSalaryPeriodOfficialPosting,
  requestSalaryPeriodClose,
  requestSalaryPeriodReopen,
} from '../services/salary-period-close.service';
import {
  approveSalaryPeriodAdjustment,
  checkSalaryPeriodAdjustment,
  getSalaryPeriodAdjustmentTotals,
  listSalaryPeriodAdjustments,
  requestSalaryPeriodAdjustment,
} from '../services/salary-period-adjustment.service';
import { resolveSalaryPeriodDateRange } from '../services/salary-period.service';
import { getClosedPeriodLock, resolveSalaryPeriodAuthority } from '../services/period-lock.service';
import { db } from '../db';
import * as s from '../db/schema';
import { eq, inArray, and } from 'drizzle-orm';
import { ApiError } from '../errors';
import { getRequestIdempotencyKey } from './utils/idempotency';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../services/idempotency.service';
import {
  approveSalaryConfirmation,
  approveSalaryReopen,
  checkSalaryConfirmation,
  checkSalaryReopen,
  requestSalaryConfirmation,
  requestSalaryReopen,
} from '../services/salary-confirmation-governance.service';

const router = Router();
const SALARY_CONFIRMATION_ACTIVE_STATUSES = ['PENDING_CHECK', 'PENDING_APPROVAL'] as const;

function toSalaryConfirmationSubjectKey(driverId: number, year: number, month: number): string {
  return `${driverId}:${toPeriodKey(year, month)}`;
}

function parseGovernanceActionId(raw: string): number {
  const actionId = Number(raw);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  return actionId;
}

function toPeriodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

async function enrichSalaryWithPostCloseAdjustments(
  driverId: number,
  year: number,
  month: number,
  salary: Awaited<ReturnType<typeof computeSalary>>,
) {
  const period = toPeriodKey(year, month);
  const total = (await getSalaryPeriodAdjustmentTotals(period, [driverId])).get(driverId) ?? 0;
  return {
    ...salary,
    postCloseAdjustment: total,
    netSalary: salary.netSalary + total,
  };
}

async function enrichSalaryListWithPostCloseAdjustments(
  year: number,
  month: number,
  items: Awaited<ReturnType<typeof computeAllDriverSalaries>>['items'],
) {
  const period = toPeriodKey(year, month);
  const totals = await getSalaryPeriodAdjustmentTotals(
    period,
    items.map((item) => item.id),
  );
  return items.map((item) => {
    if (!item.salary) {
      return item;
    }
    const total = totals.get(item.id) ?? 0;
    return {
      ...item,
      salary: {
        ...item.salary,
        postCloseAdjustment: total,
        netSalary: item.salary.netSalary + total,
      },
    };
  });
}

// GET /api/salary — list all drivers with their salary summary for a given month/year
router.get('/', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const year = parseInt(req.query.year as string, 10) || new Date().getFullYear();
  const month = parseInt(req.query.month as string, 10) || new Date().getMonth() + 1;

  const result = await computeAllDriverSalaries(year, month);
  res.json({
    ...result,
    items: await enrichSalaryListWithPostCloseAdjustments(year, month, result.items),
  });
}));

router.get('/periods/:period/overview', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  let driverId: number | null = null;
  if (req.query.driverId != null) {
    const parsedDriverId = Number(req.query.driverId);
    if (!Number.isInteger(parsedDriverId) || parsedDriverId < 1) {
      throw new ApiError(400, 'driverId không hợp lệ');
    }
    driverId = parsedDriverId;
  }
  res.json({
    lifecycle: await getSalaryPeriodLifecycle(String(req.params.period)),
    adjustments: await listSalaryPeriodAdjustments({
      period: String(req.params.period),
      driverId,
    }),
  });
}));

router.post('/periods/:period/close', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const period = String(req.params.period);
  const note = typeof req.body?.note === 'string' ? req.body.note : null;
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SALARY_PERIOD_CLOSE,
    idempotencyKey,
    payload: { actorId: user.userId, actorRole: user.role, note, period },
    createdBy: user.userId,
    entityType: 'salary_period',
    create: () => requestSalaryPeriodClose({
      period,
      actorId: user.userId,
      actorRole: user.role,
      reason: note,
      note,
    }),
  });
  const statusCode = replayed ? 200 : 201;
  res.status(statusCode).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/periods/:period/close-actions/:actionId/check', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const input = governanceActionVersionSchema.parse(req.body);
  const user = getUser(req);
  res.json(await checkSalaryPeriodClose({
    period: String(req.params.period),
    actionId: parseGovernanceActionId(String(req.params.actionId)),
    actorId: user.userId,
    actorRole: user.role,
    expectedVersion: input.expectedVersion,
  }));
}));

router.post('/periods/:period/close-actions/:actionId/approve', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const input = governanceActionVersionSchema.parse(req.body);
  const user = getUser(req);
  res.json(await approveSalaryPeriodClose({
    period: String(req.params.period),
    actionId: parseGovernanceActionId(String(req.params.actionId)),
    actorId: user.userId,
    actorRole: user.role,
    expectedVersion: input.expectedVersion,
  }));
}));

router.post('/periods/:period/reopen', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const body = req.body ?? {};
  const expectedVersion = body && typeof body === 'object' ? Number((body as { expectedVersion?: unknown }).expectedVersion) : null;
  const period = String(req.params.period);
  const reason = typeof (body as { reason?: unknown }).reason === 'string' ? (body as { reason: string }).reason : null;
  const note = typeof (body as { note?: unknown }).note === 'string' ? (body as { note: string }).note : null;
  const normalizedExpectedVersion = Number.isInteger(expectedVersion) ? expectedVersion : null;
  const reopenExpectedVersion = normalizedExpectedVersion ?? 0;
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SALARY_PERIOD_REOPEN,
    idempotencyKey,
    payload: {
      actorId: user.userId,
      actorRole: user.role,
      expectedVersion: normalizedExpectedVersion,
      reason,
      note,
      period,
    },
    createdBy: user.userId,
    entityType: 'salary_period',
    create: () => requestSalaryPeriodReopen({
      period,
      actorId: user.userId,
      actorRole: user.role,
      reason,
      note,
      expectedVersion: reopenExpectedVersion,
    }),
  });
  const statusCode = replayed ? 200 : 201;
  res.status(statusCode).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/periods/:period/reopen-actions/:actionId/check', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const input = governanceActionVersionSchema.parse(req.body);
  const user = getUser(req);
  res.json(await checkSalaryPeriodReopen({
    period: String(req.params.period),
    actionId: parseGovernanceActionId(String(req.params.actionId)),
    actorId: user.userId,
    actorRole: user.role,
    expectedVersion: input.expectedVersion,
  }));
}));

router.post('/periods/:period/reopen-actions/:actionId/approve', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const input = governanceActionVersionSchema.parse(req.body);
  const user = getUser(req);
  res.json(await approveSalaryPeriodReopen({
    period: String(req.params.period),
    actionId: parseGovernanceActionId(String(req.params.actionId)),
    actorId: user.userId,
    actorRole: user.role,
    expectedVersion: input.expectedVersion,
  }));
}));

router.post('/periods/:period/issue', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const body = req.body ?? {};
  const expectedVersion = body && typeof body === 'object' ? Number((body as { expectedVersion?: unknown }).expectedVersion) : null;
  const result = await issueSalaryPeriodPayslips({
    period: String(req.params.period),
    actorId: user.userId,
    actorRole: user.role,
    note: typeof (body as { note?: unknown }).note === 'string' ? (body as { note: string }).note : null,
    expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : null,
  });
  res.status(result.idempotentNoop ? 200 : 201).json(result);
}));

router.post('/periods/:period/post', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const body = req.body ?? {};
  const expectedVersion = body && typeof body === 'object' ? Number((body as { expectedVersion?: unknown }).expectedVersion) : null;
  const result = await markSalaryPeriodOfficialPosting({
    period: String(req.params.period),
    actorId: user.userId,
    actorRole: user.role,
    note: typeof (body as { note?: unknown }).note === 'string' ? (body as { note: string }).note : null,
    expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : null,
  });
  res.status(result.idempotentNoop ? 200 : 201).json(result);
}));

router.post('/periods/:period/adjustments', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const body = req.body ?? {};
  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'Thiếu dữ liệu điều chỉnh hậu chốt');
  }

  const driverId = Number((body as { driverId?: unknown }).driverId);
  const targetPeriod = typeof (body as { targetPeriod?: unknown }).targetPeriod === 'string'
    ? (body as { targetPeriod: string }).targetPeriod
    : '';
  const reason = typeof (body as { reason?: unknown }).reason === 'string'
    ? (body as { reason: string }).reason
    : '';
  const amount = Number((body as { amount?: unknown }).amount);
  const expectedVersion = Number((body as { expectedVersion?: unknown }).expectedVersion);

  const result = await requestSalaryPeriodAdjustment({
    sourcePeriod: String(req.params.period),
    targetPeriod,
    driverId,
    amount,
    reason,
    actorId: user.userId,
    actorRole: user.role,
    expectedVersion,
  });
  res.status(201).json(result);
}));

router.post('/periods/:period/adjustments/:actionId/check', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const user = getUser(req);
  res.json(await checkSalaryPeriodAdjustment({
    actionId,
    actorId: user.userId,
    actorRole: user.role,
  }));
}));

router.post('/periods/:period/adjustments/:actionId/approve', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const user = getUser(req);
  res.json(await approveSalaryPeriodAdjustment({
    actionId,
    actorId: user.userId,
    actorRole: user.role,
  }));
}));

// GET /api/salary/:driverId/:year/:month — full salary computation for one driver
router.get('/:driverId/:year/:month', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(String(req.params.driverId), 10);
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);

  if (!driverId || !year || !month || month < 1 || month > 12) {
    throw new ApiError(400, 'Tham số không hợp lệ');
  }

  const salary = await enrichSalaryWithPostCloseAdjustments(
    driverId,
    year,
    month,
    await computeSalary(driverId, year, month),
  );
  res.json(salary);
}));

// PUT /api/salary/:driverId/:year/:month/workdays — batch update work days
router.put('/:driverId/:year/:month/workdays', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(String(req.params.driverId), 10);
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);
  const { items } = req.body as {
    items: Array<{ date: string; status: 'TRIP_DAY' | 'STANDBY' | 'PERSONAL_LEAVE' | null; note?: string | null }>;
  };

  if (!Array.isArray(items)) {
    throw new ApiError(400, 'Cần có danh sách ngày công');
  }

  // Validate that all dates belong to the resolved salary period
  const period = await resolveSalaryPeriodDateRange(month, year);
  for (const item of items) {
    if (item.date < period.start || item.date > period.end) {
      throw new ApiError(400, `Ngày ${item.date} ngoài kỳ lương (${period.start} – ${period.end})`);
    }
  }

  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SALARY_WORKDAYS,
    idempotencyKey,
    payload: { actorId: actor.userId, driverId, items, month, year },
    createdBy: actor.userId,
    entityType: 'salary_confirmation',
    create: async (tx) => {
      const [confirmation] = await tx.select({ status: s.salaryConfirmations.status })
        .from(s.salaryConfirmations)
        .where(and(
          eq(s.salaryConfirmations.driverId, driverId),
          eq(s.salaryConfirmations.year, year),
          eq(s.salaryConfirmations.month, month),
        )).limit(1);
      if (confirmation?.status === 'CONFIRMED') {
        throw new ApiError(400, 'Kỳ lương đã xác nhận, không thể chỉnh sửa ngày công');
      }
      const closedLock = await getClosedPeriodLock(
        tx,
        await resolveSalaryPeriodAuthority(`${year}-${String(month).padStart(2, '0')}`),
      );
      if (closedLock) {
        throw new ApiError(
          409,
          `Kỳ lương ${closedLock.periodKey} đã khóa. Sau khi chốt chỉ được xử lý bằng điều chỉnh bổ sung, không sửa trực tiếp ngày công cũ.`,
        );
      }
      const [pendingConfirmation] = await tx.select({ id: s.governanceActions.id })
        .from(s.governanceActions)
        .where(and(
          eq(s.governanceActions.subjectType, 'SALARY_CONFIRMATION'),
          eq(s.governanceActions.subjectKey, toSalaryConfirmationSubjectKey(driverId, year, month)),
          eq(s.governanceActions.actionKind, 'SALARY_CONFIRMATION'),
          inArray(s.governanceActions.status, SALARY_CONFIRMATION_ACTIVE_STATUSES),
        ))
        .limit(1);
      if (pendingConfirmation) {
        throw new ApiError(
          409,
          'Đang có yêu cầu xác nhận bảng công và lương chờ xử lý. Hãy hoàn tất hoặc hủy yêu cầu trước khi sửa ngày công.',
        );
      }
      const results = await batchUpsertWorkDays(driverId, items, actor.userId, tx);
      const salary = await computeSalary(driverId, year, month, undefined, tx);
      return { results, salary };
    },
  });
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

// POST /api/salary/:driverId/:year/:month/confirm — confirm salary period (DRAFT → CONFIRMED)
router.post('/:driverId/:year/:month/confirm', requireRoles(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(String(req.params.driverId), 10);
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);

  if (!driverId || !year || !month || month < 1 || month > 12) {
    throw new ApiError(400, 'Tham số không hợp lệ');
  }
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SALARY_CONFIRM,
    idempotencyKey,
    payload: { actorId: actor.userId, driverId, month, year },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: async () => requestSalaryConfirmation({
      driverId,
      year,
      month,
      actorId: actor.userId,
      actorRole: actor.role,
    }),
  });
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/:driverId/:year/:month/confirm-actions/:actionId/check', requireRoles(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(String(req.params.driverId), 10);
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);
  const input = governanceActionVersionSchema.parse(req.body);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const actionId = parseGovernanceActionId(String(req.params.actionId));
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK,
    idempotencyKey,
    payload: {
      actionId,
      actorId: actor.userId,
      actorRole: actor.role,
      driverId,
      expectedVersion: input.expectedVersion,
      month,
      year,
    },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: async () => checkSalaryConfirmation({
      driverId,
      year,
      month,
      actionId,
      actorId: actor.userId,
      actorRole: actor.role,
      expectedVersion: input.expectedVersion,
    }),
  });
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/:driverId/:year/:month/confirm-actions/:actionId/approve', requireRoles(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(String(req.params.driverId), 10);
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);
  const input = governanceActionVersionSchema.parse(req.body);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const actionId = parseGovernanceActionId(String(req.params.actionId));
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE,
    idempotencyKey,
    payload: {
      actionId,
      actorId: actor.userId,
      actorRole: actor.role,
      driverId,
      expectedVersion: input.expectedVersion,
      month,
      year,
    },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: async () => approveSalaryConfirmation({
      driverId,
      year,
      month,
      actionId,
      actorId: actor.userId,
      actorRole: actor.role,
      expectedVersion: input.expectedVersion,
    }),
  });
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

// POST /api/salary/:driverId/:year/:month/unconfirm — reopen confirmed salary period (CONFIRMED → DRAFT)
router.post('/:driverId/:year/:month/unconfirm', requireRoles(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(String(req.params.driverId), 10);
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);

  if (!driverId || !year || !month || month < 1 || month > 12) {
    throw new ApiError(400, 'Tham số không hợp lệ');
  }
  const actor = getUser(req);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SALARY_UNCONFIRM,
    idempotencyKey,
    payload: { actorId: actor.userId, driverId, month, reason, year },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: async () => requestSalaryReopen({
      driverId,
      year,
      month,
      actorId: actor.userId,
      actorRole: actor.role,
      reason,
    }),
  });
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/:driverId/:year/:month/unconfirm-actions/:actionId/check', requireRoles(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(String(req.params.driverId), 10);
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);
  const input = governanceActionVersionSchema.parse(req.body);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const actionId = parseGovernanceActionId(String(req.params.actionId));
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_CHECK,
    idempotencyKey,
    payload: {
      actionId,
      actorId: actor.userId,
      actorRole: actor.role,
      driverId,
      expectedVersion: input.expectedVersion,
      month,
      year,
    },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: async () => checkSalaryReopen({
      driverId,
      year,
      month,
      actionId,
      actorId: actor.userId,
      actorRole: actor.role,
      expectedVersion: input.expectedVersion,
    }),
  });
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/:driverId/:year/:month/unconfirm-actions/:actionId/approve', requireRoles(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(String(req.params.driverId), 10);
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);
  const input = governanceActionVersionSchema.parse(req.body);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const actionId = parseGovernanceActionId(String(req.params.actionId));
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.GOVERNANCE_APPROVE,
    idempotencyKey,
    payload: {
      actionId,
      actorId: actor.userId,
      actorRole: actor.role,
      driverId,
      expectedVersion: input.expectedVersion,
      month,
      year,
    },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: async () => approveSalaryReopen({
      driverId,
      year,
      month,
      actionId,
      actorId: actor.userId,
      actorRole: actor.role,
      expectedVersion: input.expectedVersion,
    }),
  });
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

// GET /api/salary/:driverId/:year/:month/workdays — get raw work day records for calendar
router.get('/:driverId/:year/:month/workdays', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(String(req.params.driverId), 10);
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);
  const period = await resolveSalaryPeriodDateRange(month, year);
  const workDays = await getWorkDays(driverId, period.start, period.end);

  // Also get linked trip names for TRIP_DAY records
  const tripIds = workDays
    .filter(w => w.status === 'TRIP_DAY' && w.tripId)
    .map(w => w.tripId!);

  let trips: Array<{ id: number; tripCode: string | null; routeName: string | null }> = [];
  if (tripIds.length > 0) {
    trips = await db.select({
      id: s.trips.id,
      tripCode: s.trips.tripCode,
      routeName: s.routes.name,
    }).from(s.trips)
      .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
      .where(inArray(s.trips.id, tripIds));
  }

  const tripMap = Object.fromEntries(trips.map(t => [t.id, t]));

  const enriched = workDays.map(w => ({
    ...w,
    trip: w.tripId ? tripMap[w.tripId] ?? null : null,
  }));

  res.json({ period, workDays: enriched });
}));

export default router;
