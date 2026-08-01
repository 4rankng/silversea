// Agent tools — Salary & attendance domain.
// Casbin `salary`: ADMIN/MANAGER/ACCOUNTANT == OFFICE_ROLES.
import { z } from 'zod';
import { computeSalary, computeAllDriverSalaries, computeAttendanceSummary } from '../../attendance.service';
import { defineReadTool, OFFICE_ROLES } from '../tool.types';

const monthSchema = z.coerce.number().int().min(1).max(12);
const yearSchema = z.coerce.number().int().min(2000);

export const salaryTools = [
  defineReadTool({
    name: 'salary.compute',
    description:
      'Tính lương đầy đủ của một tài xế theo tháng (chấm công + doanh thu chuyến). Dùng cho "lương tài xế X tháng này bao nhiêu".',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      driverId: z.coerce.number().int().positive(),
      year: yearSchema,
      month: monthSchema,
    }),
    run: (args) => computeSalary(args.driverId, args.year, args.month),
    label: (a) => `Lương lái xe tháng ${a.month}/${a.year}`,
  }),

  defineReadTool({
    name: 'salary.all_drivers',
    description: 'Tính lương của tất cả tài xế trong một tháng. Dùng cho "tổng quỹ lương tháng này".',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ year: yearSchema, month: monthSchema }),
    run: (args) => computeAllDriverSalaries(args.year, args.month),
    label: (a) => `Quỹ lương ${a.month}/${a.year}`,
  }),

  defineReadTool({
    name: 'salary.attendance',
    description: 'Tóm tắt chấm công của một tài xế theo tháng (số ngày làm, nghỉ, chờ).',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      driverId: z.coerce.number().int().positive(),
      year: yearSchema,
      month: monthSchema,
    }),
    run: (args) => computeAttendanceSummary(args.driverId, args.year, args.month),
    label: (a) => `Chấm công lái xe tháng ${a.month}/${a.year}`,
  }),
] as const;
