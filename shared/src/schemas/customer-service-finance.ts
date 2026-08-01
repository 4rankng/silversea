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

export const ACCOUNTING_TRANSPORT_OWNERSHIP = ['OWN', 'EXTERNAL'] as const;
export const ACCOUNTING_TRANSPORT_READINESS = [
  'READY',
  'MISSING_PROFITABILITY_SNAPSHOT',
] as const;

export const accountingTransportRegisterQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  customerId: z.coerce.number().int().positive().optional(),
  carrierId: z.coerce.number().int().positive().optional(),
  ownership: z.enum(ACCOUNTING_TRANSPORT_OWNERSHIP).optional(),
  readiness: z.enum(ACCOUNTING_TRANSPORT_READINESS).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict().refine((input) => input.from <= input.to, {
  message: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc',
  path: ['to'],
});

const moneyStringSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/);

export const accountingTransportRegisterRowSchema = z.object({
  financialPostingId: z.number().int().positive(),
  financialPostingVersion: z.number().int().positive(),
  financialPostingEffectiveAt: z.string().datetime(),
  tripId: z.number().int().positive(),
  tripCode: z.string().nullable(),
  completionDate: z.string().date(),
  customerId: z.number().int().positive(),
  customerName: z.string(),
  carrierId: z.number().int().positive().nullable(),
  carrierName: z.string().nullable(),
  ownership: z.enum(ACCOUNTING_TRANSPORT_OWNERSHIP),
  shipmentId: z.number().int().positive().nullable(),
  shipmentCode: z.string().nullable(),
  routeId: z.number().int().positive(),
  routeName: z.string(),
  factoryName: z.string().nullable(),
  containerNumbers: z.array(z.string()),
  containerTypes: z.array(z.string()),
  plateNumber: z.string().nullable(),
  revenue: moneyStringSchema.nullable(),
  directCost: moneyStringSchema.nullable(),
  carrierPayable: moneyStringSchema,
  profit: moneyStringSchema.nullable(),
  readiness: z.object({
    status: z.enum(ACCOUNTING_TRANSPORT_READINESS),
    acceptedPodSubmissionId: z.number().int().positive(),
    acceptedPodVersion: z.number().int().positive(),
    acceptedPodAt: z.string().datetime(),
    profitabilitySnapshotId: z.number().int().positive().nullable(),
    evidence: z.array(z.string()),
  }).strict(),
}).strict();

export const accountingTransportRegisterResponseSchema = z.object({
  asOf: z.string().datetime(),
  timezone: z.literal('Asia/Ho_Chi_Minh'),
  filterFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  page: z.number().int().positive(),
  limit: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  items: z.array(accountingTransportRegisterRowSchema),
}).strict();

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
export type AccountingTransportOwnership = typeof ACCOUNTING_TRANSPORT_OWNERSHIP[number];
export type AccountingTransportReadiness = typeof ACCOUNTING_TRANSPORT_READINESS[number];
export type AccountingTransportRegisterQuery = z.infer<typeof accountingTransportRegisterQuerySchema>;
export type AccountingTransportRegisterRow = z.infer<typeof accountingTransportRegisterRowSchema>;
export type AccountingTransportRegisterResponse = z.infer<typeof accountingTransportRegisterResponseSchema>;
