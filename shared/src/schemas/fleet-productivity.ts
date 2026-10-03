import { z } from 'zod';

export const fleetProductivityDailyQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải theo định dạng YYYY-MM-DD'),
});

export const fleetProductivityMonthlyQuerySchema = z.object({
  year: z.coerce.number().int().min(2020, 'Năm tối thiểu là 2020').max(2050, 'Năm tối đa là 2050'),
  month: z.coerce.number().int().min(1, 'Tháng từ 1 đến 12').max(12, 'Tháng từ 1 đến 12'),
  truckId: z.coerce.number().int().positive('ID xe không hợp lệ').optional(),
});

export type FleetProductivityDailyQuery = z.infer<typeof fleetProductivityDailyQuerySchema>;
export type FleetProductivityMonthlyQuery = z.infer<typeof fleetProductivityMonthlyQuerySchema>;
