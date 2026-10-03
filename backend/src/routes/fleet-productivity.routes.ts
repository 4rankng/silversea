import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  Role,
  fleetProductivityDailyQuerySchema,
  fleetProductivityMonthlyQuerySchema,
} from '@tingting/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireRoles } from '../middleware/casbin';
import { ApiError } from '../errors';
import {
  getDailyFleetProductivity,
  getMonthlyFleetProductivity,
  exportMonthlyFleetProductivityXlsx,
} from '../services/internal-fleet-productivity.service';

const router = Router();
const FLEET_REPORT_ROLES = requireRoles(Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT);

/**
 * GET /api/fleet/productivity/daily?date=YYYY-MM-DD
 * Báo cáo hiệu quả năng suất của toàn bộ xe nội bộ trong 1 ngày.
 */
router.get(
  '/daily',
  FLEET_REPORT_ROLES,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = fleetProductivityDailyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Ngày báo cáo không hợp lệ (YYYY-MM-DD)');
    }
    const result = await getDailyFleetProductivity(parsed.data.date);
    res.json({ success: true, data: result });
  })
);

/**
 * GET /api/fleet/productivity/monthly?year=YYYY&month=MM&truckId=123
 * Báo cáo hiệu quả năng suất của từng xe nội bộ trong 1 tháng.
 */
router.get(
  '/monthly',
  FLEET_REPORT_ROLES,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = fleetProductivityMonthlyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Tháng hoặc năm báo cáo không hợp lệ');
    }
    const result = await getMonthlyFleetProductivity(
      parsed.data.year,
      parsed.data.month,
      parsed.data.truckId
    );
    res.json({ success: true, data: result });
  })
);

/**
 * GET /api/fleet/productivity/monthly/export?year=YYYY&month=MM
 * Xuất file Excel (.xlsx) Báo cáo Năng suất Xe Nội bộ theo Tháng.
 */
router.get(
  '/monthly/export',
  FLEET_REPORT_ROLES,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = fleetProductivityMonthlyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Tháng hoặc năm báo cáo không hợp lệ');
    }
    const buffer = await exportMonthlyFleetProductivityXlsx(
      parsed.data.year,
      parsed.data.month
    );
    const filename = `bao-cao-nang-suat-xe-noi-bo-${parsed.data.month}-${parsed.data.year}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

export default router;
