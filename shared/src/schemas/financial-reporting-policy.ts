import { z } from 'zod';

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const isoDateOnlySchema = z.string().refine(
  isValidDateOnly,
  'Ngày không hợp lệ',
);

export const vietnamMonthStartSchema = isoDateOnlySchema.refine(
  (value) => value.endsWith('-01'),
  'Tháng hiệu lực phải là ngày đầu tháng',
);

const nonNegativeWholeMoneySchema = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Giá trị phải là số nguyên không âm',
    });
    return z.NEVER;
  }
  return raw;
});

export const financialReportingPolicyRequestSchema = z.object({
  expectedPublicVersion: z.string().datetime({ offset: true }).nullable().optional(),
  effectiveFrom: vietnamMonthStartSchema,
  lowMarginThresholdPercent: z.number()
    .min(0, 'Ngưỡng cảnh báo phải từ 0% đến 100%')
    .max(100, 'Ngưỡng cảnh báo phải từ 0% đến 100%')
    .nullable(),
});

export const truckFinancialProfileRequestSchema = z.object({
  expectedPublicVersion: z.string().datetime({ offset: true }).nullable().optional(),
  truckId: z.number().int().positive(),
  effectiveFrom: vietnamMonthStartSchema,
  acquisitionCost: nonNegativeWholeMoneySchema,
  residualValue: nonNegativeWholeMoneySchema,
  inServiceDate: isoDateOnlySchema,
  usefulLifeMonths: z.number().int().positive('Thời gian sử dụng phải lớn hơn 0'),
  monthlyFixedCost: nonNegativeWholeMoneySchema,
}).superRefine((value, ctx) => {
  if (BigInt(value.residualValue) > BigInt(value.acquisitionCost)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['residualValue'],
      message: 'Giá trị thu hồi không được lớn hơn nguyên giá',
    });
  }
});

export const financialReportingSourceSchema = z.enum([
  'APPROVED_GOVERNANCE',
  'UNCONFIGURED',
]);

export const financialReportingPendingStatusSchema = z.enum([
  'PENDING_CHECK',
  'PENDING_APPROVAL',
  'RETURNED_FOR_EVIDENCE',
]);

export const financialReportingPendingRequestSchema = z.object({
  status: financialReportingPendingStatusSchema,
  requestedAt: z.string().datetime({ offset: true }),
  requestedByName: z.string(),
  effectiveFrom: isoDateOnlySchema,
  queuePath: z.string(),
});

export const financialReportingPolicyVersionSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  effectiveFrom: isoDateOnlySchema,
  lowMarginThresholdRatio: z.number().min(0).max(1).nullable(),
  lowMarginThresholdPercent: z.number().min(0).max(100).nullable(),
  depreciationMethodLabel: z.literal('Đường thẳng'),
  allocationBasisLabel: z.literal('Tỷ trọng doanh thu chuyến hoàn thành'),
  createdByName: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  source: financialReportingSourceSchema,
});

export const financialReportingPolicyStateSchema = z.object({
  status: z.enum(['UNCONFIGURED', 'CONFIGURED']),
  currentVietnamMonthStart: isoDateOnlySchema,
  publicVersion: z.string().datetime({ offset: true }).nullable(),
  currentPolicy: financialReportingPolicyVersionSchema.nullable(),
  futurePolicies: z.array(financialReportingPolicyVersionSchema),
  history: z.array(financialReportingPolicyVersionSchema),
  pendingRequest: financialReportingPendingRequestSchema.nullable(),
});

export const truckFinancialProfileVersionSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  truckId: z.number().int().positive(),
  truckLabel: z.string(),
  effectiveFrom: isoDateOnlySchema,
  acquisitionCost: z.string(),
  residualValue: z.string(),
  inServiceDate: isoDateOnlySchema,
  usefulLifeMonths: z.number().int().positive(),
  monthlyFixedCost: z.string(),
  createdByName: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  source: financialReportingSourceSchema,
});

export const truckFinancialProfileTruckOptionSchema = z.object({
  id: z.number().int().positive(),
  label: z.string(),
  status: z.string(),
});

export const truckFinancialProfileStateSchema = z.object({
  selectedTruckId: z.number().int().positive().nullable(),
  selectedTruckLabel: z.string().nullable(),
  status: z.enum(['UNCONFIGURED', 'CONFIGURED', 'NO_TRUCK_SELECTED']),
  currentVietnamMonthStart: isoDateOnlySchema,
  publicVersion: z.string().datetime({ offset: true }).nullable(),
  trucks: z.array(truckFinancialProfileTruckOptionSchema),
  currentProfile: truckFinancialProfileVersionSchema.nullable(),
  futureProfiles: z.array(truckFinancialProfileVersionSchema),
  history: z.array(truckFinancialProfileVersionSchema),
  pendingRequest: financialReportingPendingRequestSchema.nullable(),
});

export type FinancialReportingPolicyRequest = z.infer<typeof financialReportingPolicyRequestSchema>;
export type TruckFinancialProfileRequest = z.infer<typeof truckFinancialProfileRequestSchema>;
export type FinancialReportingPendingRequest = z.infer<typeof financialReportingPendingRequestSchema>;
export type FinancialReportingPolicyVersion = z.infer<typeof financialReportingPolicyVersionSchema>;
export type FinancialReportingPolicyState = z.infer<typeof financialReportingPolicyStateSchema>;
export type TruckFinancialProfileVersion = z.infer<typeof truckFinancialProfileVersionSchema>;
export type TruckFinancialProfileTruckOption = z.infer<typeof truckFinancialProfileTruckOptionSchema>;
export type TruckFinancialProfileState = z.infer<typeof truckFinancialProfileStateSchema>;
