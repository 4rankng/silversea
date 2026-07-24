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
  computeAllDriverSalaries,
  confirmSalary,
  unconfirmSalary,
} from '../services/attendance.service';
import { resolveSalaryPeriodDateRange } from '../services/salary-period.service';
import { db } from '../db';
import * as s from '../db/schema';
import { eq, inArray, and } from 'drizzle-orm';
import { ApiError } from '../errors';

const router = Router();

// GET /api/salary — list all drivers with their salary summary for a given month/year
router.get('/', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const year = parseInt(req.query.year as string, 10) || new Date().getFullYear();
  const month = parseInt(req.query.month as string, 10) || new Date().getMonth() + 1;

  res.json(await computeAllDriverSalaries(year, month));
}));

// GET /api/salary/:driverId/:year/:month — full salary computation for one driver
router.get('/:driverId/:year/:month', requireRoles(Role.MANAGER, Role.ADMIN, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(String(req.params.driverId), 10);
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);

  if (!driverId || !year || !month || month < 1 || month > 12) {
    throw new ApiError(400, 'Tham số không hợp lệ');
  }

  const salary = await computeSalary(driverId, year, month);
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

  // Guard: reject updates if salary period is confirmed
  const [confirmation] = await db.select({ status: s.salaryConfirmations.status })
    .from(s.salaryConfirmations)
    .where(and(
      eq(s.salaryConfirmations.driverId, driverId),
      eq(s.salaryConfirmations.year, year),
      eq(s.salaryConfirmations.month, month),
    )).limit(1);
  if (confirmation?.status === 'CONFIRMED') {
    throw new ApiError(400, 'Kỳ lương đã xác nhận, không thể chỉnh sửa ngày công');
  }

  // Validate that all dates belong to the resolved salary period
  const period = await resolveSalaryPeriodDateRange(month, year);
  for (const item of items) {
    if (item.date < period.start || item.date > period.end) {
      throw new ApiError(400, `Ngày ${item.date} ngoài kỳ lương (${period.start} – ${period.end})`);
    }
  }

  const results = await batchUpsertWorkDays(driverId, items, getUser(req).userId);
  // Return updated salary summary
  const salary = await computeSalary(driverId, year, month);
  res.json({ results, salary });
}));

// POST /api/salary/:driverId/:year/:month/confirm — confirm salary period (DRAFT → CONFIRMED)
router.post('/:driverId/:year/:month/confirm', requireRoles(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(String(req.params.driverId), 10);
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);

  if (!driverId || !year || !month || month < 1 || month > 12) {
    throw new ApiError(400, 'Tham số không hợp lệ');
  }

  const result = await confirmSalary(driverId, year, month, getUser(req).userId);
  res.json(result);
}));

// POST /api/salary/:driverId/:year/:month/unconfirm — reopen confirmed salary period (CONFIRMED → DRAFT)
router.post('/:driverId/:year/:month/unconfirm', requireRoles(Role.ADMIN, Role.ACCOUNTANT, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const driverId = parseInt(String(req.params.driverId), 10);
  const year = parseInt(String(req.params.year), 10);
  const month = parseInt(String(req.params.month), 10);

  if (!driverId || !year || !month || month < 1 || month > 12) {
    throw new ApiError(400, 'Tham số không hợp lệ');
  }

  const result = await unconfirmSalary(driverId, year, month);
  res.json(result);
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
