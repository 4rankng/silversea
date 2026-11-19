import { Router } from 'express';
import { z } from 'zod';
import { TIMESHEET_SALARY_MODES, TIMESHEET_SYMBOLS } from '@tingting/shared';
import { Role } from '@tingting/shared';
import { getUser } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireRoles } from '../middleware/casbin';
import { throwValidation } from '../lib/validation';
import { parseId } from './utils/parse-id';
import {
  adjustTimesheetDay,
  createTimesheetMonth,
  getTimesheetMonth,
  listTimesheetDrivers,
  listTimesheetMonths,
  reconcileTimesheetMonth,
  reopenTimesheetMonth,
  saveTimesheetDays,
  updateTimesheetMode,
  getTimesheetRollup,
  type TimesheetActor,
} from '../services/timesheet.service';
import { declareMaterialWrite } from '../middleware/material-write';

const router = Router();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throwValidation(result.error);
  return result.data;
}

function actorOf(req: Parameters<typeof getUser>[0]): TimesheetActor {
  const user = getUser(req);
  return { userId: user.userId, fullName: user.fullName, role: user.role };
}

const periodQuery = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

const symbolSchema = z.enum(TIMESHEET_SYMBOLS);
const salaryModeSchema = z.enum(TIMESHEET_SALARY_MODES);

// Kế toán owns the mode and the reconciliation; the grid seats fill the grid.
// SIL-842 (CR-008 Task 2.2) — mở bảng chấm công KHÔNG còn là việc riêng của Kế
// toán: người thao tác lưới tự khởi tạo lưới tháng khi mở trang (POST /months
// theo chế độ mặc định của lái xe). Đổi chế độ lương (PATCH …/mode) và đối
// chiếu vẫn là việc của Kế toán (accountantOnly).
// SIL-862 — ghế thao tác lưới gồm cả Vận hành (OPS): tài khoản repro hoangnh
// (role OPS, NV003) mở /timesheet, tự khởi tạo tháng và ghi lưới y như
// DISPATCHER; các route Kế toán-only bên dưới giữ nguyên.
export const TIMESHEET_MONTH_OPENERS: readonly Role[] = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.DISPATCHER, Role.OPS];
export const TIMESHEET_GRID_EDITORS: readonly Role[] = [Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.OPS];
const accountantOnly = requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT);
const gridEditors = requireRoles(...TIMESHEET_GRID_EDITORS);
const boardOpeners = requireRoles(...TIMESHEET_MONTH_OPENERS);

router.get('/drivers', asyncHandler(async (req, res) => {
  const query = parse(periodQuery, req.query);
  res.json({ items: await listTimesheetDrivers(query.year, query.month) });
}));

router.get('/months', asyncHandler(async (req, res) => {
  const query = parse(periodQuery, req.query);
  res.json({ items: await listTimesheetMonths(query.year, query.month) });
}));

router.get('/months/:id', asyncHandler(async (req, res) => {
  res.json(await getTimesheetMonth(parseId(req.params.id as string, 'ID tháng chấm công')));
}));

router.get('/rollup', asyncHandler(async (req, res) => {
  const query = parse(periodQuery, req.query);
  res.json({ items: await getTimesheetRollup(query.year, query.month) });
}));

router.post('/months', boardOpeners, declareMaterialWrite('timesheet.month.create', { method: 'POST', path: '/api/timesheet/months' }), asyncHandler(async (req, res) => {
  const input = parse(z.object({
    driverId: z.number().int().positive(),
    year: z.number().int().min(2020).max(2100),
    month: z.number().int().min(1).max(12),
    salaryMode: salaryModeSchema.optional(),
    dailyBase: z.number().int().nonnegative().nullable().optional(),
    flatAmount: z.number().int().nonnegative().nullable().optional(),
  }).strict(), req.body);
  res.status(201).json(await createTimesheetMonth(actorOf(req), input));
}));

router.patch('/months/:id/mode', accountantOnly, declareMaterialWrite('timesheet.month.mode', { method: 'PATCH', path: '/api/timesheet/months/:id/mode' }), asyncHandler(async (req, res) => {
  const monthId = parseId(req.params.id as string, 'ID tháng chấm công');
  const input = parse(z.object({
    salaryMode: salaryModeSchema.optional(),
    dailyBase: z.number().int().nonnegative().nullable().optional(),
    flatAmount: z.number().int().nonnegative().nullable().optional(),
  }).strict(), req.body);
  res.json(await updateTimesheetMode(actorOf(req), monthId, input));
}));

// Symbols only: the server owns the trips a symbol implies.
router.put('/months/:id/days', gridEditors, declareMaterialWrite('timesheet.month.grid', { method: 'PUT', path: '/api/timesheet/months/:id/days' }), asyncHandler(async (req, res) => {
  const monthId = parseId(req.params.id as string, 'ID tháng chấm công');
  const input = parse(z.object({
    // `.strict()` on the CELL too: a smuggled `trips` must be rejected, not
    // silently dropped — otherwise a client could believe it posted 99 trips.
    days: z.array(z.object({
      workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD.'),
      symbol: symbolSchema.nullable(),
      note: z.string().max(500).nullable().optional(),
    }).strict()).min(1).max(31),
  }).strict(), req.body);
  res.json(await saveTimesheetDays(actorOf(req), monthId, input.days));
}));

router.put('/months/:id/days/:dayId/adjustment', accountantOnly, declareMaterialWrite('timesheet.day.adjust', { method: 'PUT', path: '/api/timesheet/months/:id/days/:dayId/adjustment' }), asyncHandler(async (req, res) => {
  const monthId = parseId(req.params.id as string, 'ID tháng chấm công');
  const dayId = parseId(req.params.dayId as string, 'ID ô ngày');
  const input = parse(z.object({ tripAdjustment: z.number().int().min(-10).max(10) }).strict(), req.body);
  res.json(await adjustTimesheetDay(actorOf(req), monthId, dayId, input.tripAdjustment));
}));

router.post('/months/:id/reconcile', accountantOnly, declareMaterialWrite('timesheet.month.reconcile', { method: 'POST', path: '/api/timesheet/months/:id/reconcile' }), asyncHandler(async (req, res) => {
  const monthId = parseId(req.params.id as string, 'ID tháng chấm công');
  const input = parse(z.object({ note: z.string().max(1000).nullable().optional() }).strict(), req.body ?? {});
  res.json(await reconcileTimesheetMonth(actorOf(req), monthId, input.note));
}));

router.post('/months/:id/reopen', accountantOnly, declareMaterialWrite('timesheet.month.reopen', { method: 'POST', path: '/api/timesheet/months/:id/reopen' }), asyncHandler(async (req, res) => {
  const monthId = parseId(req.params.id as string, 'ID tháng chấm công');
  res.json(await reopenTimesheetMonth(actorOf(req), monthId));
}));

export default router;