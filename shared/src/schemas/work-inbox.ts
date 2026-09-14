import { z } from 'zod';

export const workInboxStateSchema = z.enum(['ACTION', 'WAITING', 'DONE']);
export const workInboxPartySchema = z.object({ code: z.string().min(1).max(80), label: z.string().min(1).max(160), ownerRole: z.string().min(1).max(40), ownerLabel: z.string().min(1).max(160) });
export const workInboxNextActionSchema = z.object({ label: z.string().min(1).max(160), targetRoute: z.string().min(1).max(500) }).nullable();
export const workInboxItemBaseSchema = z.object({
  id: z.string().min(1), entityType: z.string().min(1).max(80), entityId: z.union([z.number().int().positive(), z.string().min(1)]),
  title: z.string().min(1).max(255), subtitle: z.string().max(500).nullable(), state: workInboxStateSchema,
  priority: z.number().finite(), dueAt: z.string().datetime().nullable(), freshnessAt: z.string().datetime(),
  blockers: z.array(workInboxPartySchema), advisories: z.array(workInboxPartySchema), nextAction: workInboxNextActionSchema, targetRoute: z.string().min(1).max(500),
});
export const workInboxResponseSchema = z.object({
  asOf: z.string().datetime(), timezone: z.literal('Asia/Ho_Chi_Minh'),
  counts: z.object({ action: z.number().int().nonnegative(), waiting: z.number().int().nonnegative(), done: z.number().int().nonnegative() }),
  page: z.number().int().positive(), limit: z.number().int().positive().max(100), total: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(), items: z.array(workInboxItemBaseSchema),
});
export type WorkInboxItemBase = z.infer<typeof workInboxItemBaseSchema>;
export type WorkInboxResponse = z.infer<typeof workInboxResponseSchema>;

// Role projections stay additive: every item retains the stable common base,
// while consumers can rely on only the facts safe and useful for their role.
export const operationsWorkInboxItemSchema = workInboxItemBaseSchema.extend({
  shipmentId: z.number().int().positive(),
  shipmentVersion: z.number().int().positive(),
  tripId: z.number().int().positive().nullable(),
  containerSummary: z.string().nullable(),
  driverName: z.string().nullable(),
  truckPlate: z.string().nullable(),
  paperOrderState: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']),
  orderExchangeState: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']),
  expenseEvidenceComplete: z.boolean(),
});
export const driverWorkInboxItemSchema = workInboxItemBaseSchema.extend({
  fulfillmentId: z.number().int().positive().nullable(),
  tripId: z.number().int().positive(),
  shipmentCode: z.string().nullable(),
  containerSummary: z.string().nullable(),
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  milestone: z.string().nullable(),
  paperOrderReady: z.boolean(),
  podState: z.enum(['MISSING', 'DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED']),
});
export const customerWorkInboxItemSchema = workInboxItemBaseSchema.extend({
  shipmentId: z.number().int().positive(),
  containerSummary: z.string().nullable(),
  deliveryTruth: z.enum(['NO_REPORT', 'IN_TRANSIT', 'DRIVER_REPORTED', 'POD_ACCEPTED']),
  deliveryResponseRequired: z.boolean(),
  deliveryEventId: z.number().int().positive().nullable(),
  deliveryEventVersion: z.number().int().positive().nullable(),
});
export const accountantWorkInboxItemSchema = workInboxItemBaseSchema.extend({ tripId: z.number().int().positive(), acceptedPod: z.boolean(), expenseApprovalPending: z.boolean(), settlementComplete: z.boolean(), profitabilitySnapshotReady: z.boolean() });
export const managerWorkInboxItemSchema = workInboxItemBaseSchema.extend({ owner: workInboxPartySchema.nullable(), ageHours: z.number().nonnegative(), impact: z.string().min(1).max(500) });
export const adminHealthInboxItemSchema = workInboxItemBaseSchema.extend({ healthState: z.enum(['HEALTHY', 'UNAVAILABLE', 'FAILED']), source: z.string().min(1).max(80) });
export type OperationsWorkInboxItem = z.infer<typeof operationsWorkInboxItemSchema>;
export type DriverWorkInboxItem = z.infer<typeof driverWorkInboxItemSchema>;
export type CustomerWorkInboxItem = z.infer<typeof customerWorkInboxItemSchema>;
export type AccountantWorkInboxItem = z.infer<typeof accountantWorkInboxItemSchema>;
export type ManagerWorkInboxItem = z.infer<typeof managerWorkInboxItemSchema>;
export type AdminHealthInboxItem = z.infer<typeof adminHealthInboxItemSchema>;
export type WorkInboxResponseOf<T extends WorkInboxItemBase> = Omit<WorkInboxResponse, 'items'> & { items: T[] };

export const customerDeliveryResponseSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  decision: z.enum(['CONFIRMED', 'DISPUTED']),
  reason: z.string().trim().min(1, 'Cần nêu lý do khi có tranh chấp').max(1000).optional(),
  evidenceRefs: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
}).superRefine((value, ctx) => {
  if (value.decision === 'DISPUTED' && !value.reason) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Cần nêu lý do khi có tranh chấp' });
});
export type CustomerDeliveryResponseInput = z.infer<typeof customerDeliveryResponseSchema>;
