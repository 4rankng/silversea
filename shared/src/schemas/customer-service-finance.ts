import { z } from 'zod';

export const CUSTOMER_VISIBLE_EVENT_TYPES = [
  'MILESTONE',
  'DELIVERY_PLAN',
  'DOCUMENT_UPDATE',
  'DEBIT_NOTE_CONFIRMATION',
] as const;

export const customerVisibleEventContentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(2000),
  occurredAt: z.string().datetime(),
  shipmentCode: z.string().trim().min(1).max(50).optional(),
}).strict();

export const createCustomerVisibleEventSchema = z.object({
  eventKey: z.string().trim().min(1).max(120),
  contentVersion: z.coerce.number().int().positive(),
  eventType: z.enum(CUSTOMER_VISIBLE_EVENT_TYPES),
  milestoneId: z.coerce.number().int().positive().optional(),
  supersedesEventId: z.coerce.number().int().positive().optional(),
  content: customerVisibleEventContentSchema,
}).strict();

export const acknowledgeCustomerEventSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  kind: z.enum(['SEEN', 'ACKNOWLEDGED']).default('ACKNOWLEDGED'),
}).strict();

export const recoverableCostListQuerySchema = z.object({
  customerId: z.coerce.number().int().positive().optional(),
  approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const recoverableCostRequestSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1).max(1000),
  evidence: z.object({
    reviewNote: z.string().trim().min(1).max(1000),
    attachmentRefs: z.array(z.string().trim().min(1).max(255)).max(20).default([]),
  }).strict(),
}).strict();

export const sendDebitNoteForConfirmationSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  recipientEmail: z.string().trim().email().optional(),
}).strict();

export const portalDebitNoteDecisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('CONFIRM'),
    expectedVersion: z.coerce.number().int().positive(),
  }).strict(),
  z.object({
    decision: z.literal('DISPUTE'),
    expectedVersion: z.coerce.number().int().positive(),
    reason: z.string().trim().min(1, 'Lý do là bắt buộc').max(1000),
    evidenceRefs: z.array(z.string().trim().min(1).max(255)).max(20).default([]),
  }).strict(),
]);

export const directMoneyTreasurySchema = z.object({
  treasuryAccountId: z.coerce.number().int().positive(),
  valueDate: z.string().date(),
  physicalReference: z.string().trim().min(1).max(160),
  externalReference: z.string().trim().min(1).max(160).optional(),
  paymentContractVersion: z.literal(2),
}).strict();

export const PROFITABILITY_DIMENSIONS = [
  'CUSTOMER',
  'ROUTE',
  'TRUCK',
  'DISPATCHER',
  'SALESPERSON',
  'MONTH',
  'YEAR',
  'CONTAINER',
] as const;

export const profitabilityReportQuerySchema = z.object({
  dimension: z.enum(PROFITABILITY_DIMENSIONS),
  from: z.string().date(),
  to: z.string().date(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict().refine((input) => input.from <= input.to, {
  message: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc',
  path: ['to'],
});

export type CustomerVisibleEventContent = z.infer<typeof customerVisibleEventContentSchema>;
export type CreateCustomerVisibleEventInput = z.infer<typeof createCustomerVisibleEventSchema>;
export type AcknowledgeCustomerEventInput = z.infer<typeof acknowledgeCustomerEventSchema>;
export type RecoverableCostListQuery = z.infer<typeof recoverableCostListQuerySchema>;
export type RecoverableCostRequestInput = z.infer<typeof recoverableCostRequestSchema>;
export type SendDebitNoteForConfirmationInput = z.infer<typeof sendDebitNoteForConfirmationSchema>;
export type PortalDebitNoteDecisionInput = z.infer<typeof portalDebitNoteDecisionSchema>;
export type DirectMoneyTreasuryInput = z.infer<typeof directMoneyTreasurySchema>;
export type ProfitabilityDimension = typeof PROFITABILITY_DIMENSIONS[number];
export type ProfitabilityReportQuery = z.infer<typeof profitabilityReportQuerySchema>;
