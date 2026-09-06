import { z } from 'zod';

const creditWarningThresholdSchema = z.number()
  .min(0.01, 'Ngưỡng cảnh báo phải lớn hơn 0')
  .max(0.99, 'Ngưỡng cảnh báo phải nhỏ hơn 1');

const vndCapSchema = z.number()
  .int('Ngưỡng tiền phải là số nguyên VND')
  .min(0, 'Ngưỡng tiền không được âm');

/** Runtime feature switches exposed in the Admin application-settings page. */
export const appSettingsSchema = z.object({
  // Q01/Q02: default early-warning threshold used when a customer does not
  // define its own override (e.g. 0.8 = 80%).
  creditWarningThresholdDefault: creditWarningThresholdSchema.default(0.8),
  // Q02: max VND over-limit amount that tier-1 finance approval can cover.
  // 0 keeps the system fail-closed until the business configures a cap.
  creditTierOneAmountCap: vndCapSchema.default(0),
  // Q09: null closes salary for the whole company. A positive business-unit
  // id limits readiness and the close total to active drivers linked to that
  // configured payroll unit.
  salaryPayrollBusinessUnitId: z.number().int().positive().nullable().default(null),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;
