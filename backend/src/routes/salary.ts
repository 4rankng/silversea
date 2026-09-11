import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireRoles } from '../middleware/casbin';
import { getUser } from '../middleware/auth';
import { Role } from '@tingting/shared';
import {
  computeSalary,
  batchUpsertWorkDays,
  getWorkDays,
  getTripLabelsForWorkDays,
  computeAllDriverSalaries,
} from '../services/attendance.service';
import {
  applySalaryPeriodCloseAction,
  applySalaryPeriodReopenAction,
  getSalaryPeriodLifecycle,
  requestSalaryPeriodClose,
  requestSalaryPeriodReopen,
} from '../services/salary-period-close.service';
import {
  getSalaryPeriodAdjustmentTotals,
  listSalaryPeriodAdjustments,
  requestSalaryPeriodAdjustment,
} from '../services/salary-period-adjustment.service';
import {
  applySalaryPeriodFinalizationAction,
  requestSalaryPeriodFinalization,
} from '../services/salary-period-finalization-governance.service';
import { resolveSalaryPeriodDateRange } from '../services/salary-period.service';
import { getClosedPeriodLock, resolveSalaryPeriodAuthority } from '../services/period-lock.service';
import * as s from '../db/schema';
import { eq, inArray, and } from 'drizzle-orm';
import { ApiError } from '../errors';
import { getRequestIdempotencyKey as readRequestIdempotencyKey } from './utils/idempotency';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../services/idempotency.service';
import {
  applySalaryConfirmationAction,
  applySalaryReopenAction,
  requestSalaryConfirmation,
  requestSalaryReopen,
} from '../services/salary-confirmation-governance.service';
import { autoApplyGovernanceAction } from '../services/adjustment-governance.service';

const router = Router();
const SALARY_PERIOD_ISSUE_ENDPOINT = 'salary-periods.issue';
const SALARY_PERIOD_POST_ENDPOINT = 'salary-periods.post';

function requireMaterialIdempotencyKey(req: Request, message: string): string {
  const idempotencyKey = readRequestIdempotencyKey(req);
  if (!idempotencyKey) {
    throw new ApiError(400, message);
  }
  return idempotencyKey;
}

function requireSalaryMutationIdempotencyKey(req: Request): string {
  return requireMaterialIdempotencyKey(
    req,
    'Idempotency-Key là bắt buộc cho thao tác thay đổi dữ liệu lương.',
  );
}

function getRequestIdempotencyKey(req: Request): string {
  return requireSalaryMutationIdempotencyKey(req);
}

function parseRequiredExpectedVersion(body: unknown): number {
  const expectedVersion = body && typeof body === 'object'
    ? Number((body as { expectedVersion?: unknown }).expectedVersion)
    : Number.NaN;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
  return expectedVersion;
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

// 2026-09-10 user directive: remove all phê duyệt flows. Governed salary
// requests apply directly in-request: the create endpoints run the make
// stage (transient action record) and the check + approve stages through
// autoApplyGovernanceAction with the domain apply adapters.

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
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => requestSalaryPeriodClose({
        period,
        actorId: user.userId,
        actorRole: user.role,
        reason: note,
        note,
        transaction: tx,
      }),
      apply: applySalaryPeriodCloseAction,
      actorId: user.userId,
      actorRole: user.role,
      transaction: tx,
    }),
  });
  const statusCode = replayed ? 200 : 201;
  res.status(statusCode).json(idempotencyKey ? { ...result, replayed } : result);
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
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => requestSalaryPeriodReopen({
        period,
        actorId: user.userId,
        actorRole: user.role,
        reason,
        note,
        expectedVersion: reopenExpectedVersion,
        transaction: tx,
      }),
      apply: applySalaryPeriodReopenAction,
      actorId: user.userId,
      actorRole: user.role,
      transaction: tx,
    }),
  });
  const statusCode = replayed ? 200 : 201;
  res.status(statusCode).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/periods/:period/issue', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const body = req.body ?? {};
  const period = String(req.params.period);
  const expectedVersion = parseRequiredExpectedVersion(body);
  const note = typeof (body as { note?: unknown }).note === 'string' ? (body as { note: string }).note : null;
  const { result, replayed, statusCode } = await runIdempotent({
    endpoint: SALARY_PERIOD_ISSUE_ENDPOINT,
    idempotencyKey: requireMaterialIdempotencyKey(
      req,
      'Idempotency-Key là bắt buộc khi phát hành phiếu lương.',
    ),
    payload: {
      actorId: user.userId,
      actorRole: user.role,
      expectedVersion,
      note,
      period,
    },
    createdBy: user.userId,
    entityType: 'salary_period',
    responseStatusCode: 201,
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => requestSalaryPeriodFinalization({
        period,
        operation: 'ISSUE_PAYSLIPS',
        actorId: user.userId,
        actorRole: user.role,
        note,
        expectedVersion,
        transaction: tx,
      }),
      apply: applySalaryPeriodFinalizationAction,
      actorId: user.userId,
      actorRole: user.role,
      transaction: tx,
    }),
    getEntityId: (action) => action.id,
  });
  res.status(statusCode).json({ ...result, replayed });
}));

router.post('/periods/:period/post', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const body = req.body ?? {};
  const period = String(req.params.period);
  const expectedVersion = parseRequiredExpectedVersion(body);
  const note = typeof (body as { note?: unknown }).note === 'string' ? (body as { note: string }).note : null;
  const { result, replayed, statusCode } = await runIdempotent({
    endpoint: SALARY_PERIOD_POST_ENDPOINT,
    idempotencyKey: requireMaterialIdempotencyKey(
      req,
      'Idempotency-Key là bắt buộc khi đánh dấu hạch toán chính thức kỳ lương.',
    ),
    payload: {
      actorId: user.userId,
      actorRole: user.role,
      expectedVersion,
      note,
      period,
    },
    createdBy: user.userId,
    entityType: 'salary_period',
    responseStatusCode: 201,
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => requestSalaryPeriodFinalization({
        period,
        operation: 'POST_OFFICIAL',
        actorId: user.userId,
        actorRole: user.role,
        note,
        expectedVersion,
        transaction: tx,
      }),
      apply: applySalaryPeriodFinalizationAction,
      actorId: user.userId,
      actorRole: user.role,
      transaction: tx,
    }),
    getEntityId: (action) => action.id,
  });
  res.status(statusCode).json({ ...result, replayed });
}));

router.post('/periods/:period/adjustments', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const period = String(req.params.period);
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
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SALARY_PERIOD_ADJUSTMENT,
    idempotencyKey,
    payload: {
      actorId: user.userId,
      actorRole: user.role,
      amount,
      driverId,
      expectedVersion,
      period,
      reason,
      targetPeriod,
    },
    createdBy: user.userId,
    entityType: 'salary_period_adjustment',
    create: (tx) => requestSalaryPeriodAdjustment({
      sourcePeriod: period,
      targetPeriod,
      driverId,
      amount,
      reason,
      actorId: user.userId,
      actorRole: user.role,
      expectedVersion,
      transaction: tx,
    }),
    getEntityId: (result) => result.adjustmentId,
  });
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
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
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => requestSalaryConfirmation({
        driverId,
        year,
        month,
        actorId: actor.userId,
        actorRole: actor.role,
        transaction: tx,
      }),
      apply: applySalaryConfirmationAction,
      actorId: actor.userId,
      actorRole: actor.role,
      transaction: tx,
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
    create: (tx) => autoApplyGovernanceAction({
      make: (tx) => requestSalaryReopen({
        driverId,
        year,
        month,
        actorId: actor.userId,
        actorRole: actor.role,
        reason,
        transaction: tx,
      }),
      apply: applySalaryReopenAction,
      actorId: actor.userId,
      actorRole: actor.role,
      transaction: tx,
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
  const trips = await getTripLabelsForWorkDays(tripIds);

  const tripMap = Object.fromEntries(trips.map(t => [t.id, t]));

  const enriched = workDays.map(w => ({
    ...w,
    trip: w.tripId ? tripMap[w.tripId] ?? null : null,
  }));

  res.json({ period, workDays: enriched });
}));

export default router;
