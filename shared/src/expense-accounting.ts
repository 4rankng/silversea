import { z } from 'zod';
import { DriverIncidentalCostType } from './constants';

export const EXPENSE_SOURCE_KINDS = ['OPS', 'DRIVER', 'TRIP', 'INVOICE'] as const;
export type ExpenseSourceKind = typeof EXPENSE_SOURCE_KINDS[number];
export const EXPENSE_COST_GROUPS = ['INVOICED_LIFT', 'INVOICED_DROP', 'INVOICED_OTHER', 'OPS_REGULAR', 'OPS_INCIDENTAL', 'DRIVER_SHIPMENT', 'DRIVER_ROAD', 'INVOICE_SERVICE'] as const;
export type ExpenseCostGroup = typeof EXPENSE_COST_GROUPS[number];
export const EXPENSE_COST_GROUP_LABELS: Record<ExpenseCostGroup, string> = {
  INVOICED_LIFT: 'Nâng có hóa đơn', INVOICED_DROP: 'Hạ có hóa đơn', INVOICED_OTHER: 'Chi hộ có hóa đơn khác',
  OPS_REGULAR: 'Giao nhận Ops', OPS_INCIDENTAL: 'Phát sinh Ops', DRIVER_SHIPMENT: 'Chi phí lô hàng',
  DRIVER_ROAD: 'Tiền đường', INVOICE_SERVICE: 'Chi phí hóa đơn',
};
/** Suggested labels only: selecting one never invents a rate or a transaction. */
export const OPS_EXPENSE_SUGGESTIONS: ReadonlyArray<{ group: ExpenseCostGroup; names: readonly string[] }> = [
  { group: 'INVOICED_LIFT', names: ['Nâng vỏ', 'Nâng hàng', 'Lưu bãi nâng'] },
  { group: 'INVOICED_DROP', names: ['Hạ vỏ', 'Hạ hàng', 'Lưu vỏ', 'Lưu bãi hạ'] },
  { group: 'INVOICED_OTHER', names: ['Hạ tầng công nghệ', 'Gia hạn', 'Vệ sinh', 'Soi chiếu', 'Kiểm hóa', 'Bốc xếp', 'Công nhân', 'Cơ sở hạ tầng', 'Lưu kho'] },
  { group: 'OPS_REGULAR', names: ['Làm hàng luồng xanh', 'Làm hàng luồng vàng', 'Làm hàng luồng đỏ', 'Chọn vỏ', 'Chi hải quan'] },
  { group: 'OPS_INCIDENTAL', names: ['Sửa tờ khai', 'Vận chuyển phát sinh', 'Chi công nhân', 'Ngoài giờ', 'Nợ phơi', 'Xe nâng', 'Kẹp chì hải quan', 'Bóc tem nguy hiểm'] },
];
export const expenseVndSchema = z.number().finite().int().min(0).max(999_999_999_999_999);
export const expenseDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Ngày không hợp lệ.');
export const expenseSourceRefSchema = z.object({ sourceKind: z.enum(EXPENSE_SOURCE_KINDS), sourceId: z.number().int().positive(), expectedVersion: z.number().int().positive() }).strict();
export type ExpenseSourceRef = z.infer<typeof expenseSourceRefSchema>;
export const expenseInputFields = {
  costGroup: z.enum(EXPENSE_COST_GROUPS).optional(), feeName: z.string().trim().min(1).max(200).optional(),
  invoiceNumber: z.string().trim().max(100).nullable().optional(), invoiceDate: expenseDateSchema.nullable().optional(),
  recoveryNote: z.string().trim().max(1000).nullable().optional(),
};
export const expenseAccountingUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(1000),
  ...expenseInputFields, amount: expenseVndSchema.refine(v => v > 0).optional(), customerChargeAmount: expenseVndSchema.optional(),
  expenseDate: expenseDateSchema.optional(), note: z.string().max(2000).nullable().optional(),
  payerKind: z.enum(['USER', 'COMPANY', 'SUPPLIER']).optional(), payerUserId: z.number().int().positive().nullable().optional(),
  photoStorageKeys: z.array(z.string().min(1).max(500)).max(20).optional(),
  tripId: z.number().int().positive().optional(),
  driverCostType: z.nativeEnum(DriverIncidentalCostType).optional(),
}).strict();
export type ExpenseAccountingUpdate = z.infer<typeof expenseAccountingUpdateSchema>;
export const expenseConfirmSchema = z.object({ entries: z.array(expenseSourceRefSchema).min(1).max(200) }).strict();
export const expenseVoucherSchema = z.object({
  direction: z.enum(['IN', 'OUT']), treasuryAccountId: z.number().int().positive(), valueDate: expenseDateSchema,
  physicalReference: z.string().trim().min(1).max(160), note: z.string().trim().max(2000).optional(),
  entries: z.array(expenseSourceRefSchema.extend({ amount: expenseVndSchema.refine(v => v > 0) })).min(1).max(200),
}).strict();
export type ExpenseVoucherInput = z.infer<typeof expenseVoucherSchema>;
export const expenseReconciliationSchema = z.object({
  opsUserId: z.number().int().positive(), from: expenseDateSchema, to: expenseDateSchema,
  entries: z.array(expenseSourceRefSchema).min(1).max(200),
  advances: z.array(z.object({ advanceRequestId: z.number().int().positive(), amount: expenseVndSchema.refine(v => v > 0) }).strict()).max(200),
  note: z.string().max(2000).optional(),
}).strict().refine(v => v.from <= v.to, 'Khoảng ngày không hợp lệ.');
export type ExpenseReconciliationInput = z.infer<typeof expenseReconciliationSchema>;
export const expenseListQuerySchema = z.object({
  sourceKind: z.enum(EXPENSE_SOURCE_KINDS).optional(), from: expenseDateSchema.optional(), to: expenseDateSchema.optional(),
  shipmentId: z.coerce.number().int().positive().optional(), payerId: z.coerce.number().int().positive().optional(),
  truckId: z.coerce.number().int().positive().optional(), accountantId: z.coerce.number().int().nonnegative().optional(),
  confirmed: z.enum(['true', 'false']).optional(), search: z.string().max(200).optional(),
  groupByVehicle: z.enum(['true', 'false']).optional(), page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;
export interface ExpenseAccountingEntry {
  id: number; sourceKind: ExpenseSourceKind; sourceId: number; version: number;
  shipmentId: number; shipmentContainerId: number | null; tripId: number | null; truckId: number | null;
  customerId: number; shipmentCode: string; tripCode: string | null; truckPlate: string | null; customerName: string;
  containerNumber: string | null; costGroup: ExpenseCostGroup | null; expenseTypeCode: string; feeName: string;
  amount: number; customerChargeAmount: number | null; invoiceNumber: string | null; invoiceDate: string | null;
  expenseDate: string; payerKind: 'USER' | 'COMPANY' | 'SUPPLIER' | null; payerUserId: number | null;
  payerName: string | null; recordedById: number | null; confirmedById: number | null; confirmedAt: string | null;
  note: string | null; recoveryNote: string | null; photoStorageKeys: string[];
  receivedAmount: number | null; paidAmount: number | null; outstandingReceivable: number | null; outstandingPayable: number | null;
  payableEntityType: 'FORWARDER' | 'DRIVER' | 'VENDOR' | 'CARRIER' | null; payableEntityId: number | null;
  linkedTripExpenseId: number | null; accountantId: number | null; status: 'RECORDED' | 'VOIDED';
  evidenceMissing: boolean; locked: boolean; reconciliationId: number | null;
  driverName: string | null; routeName: string | null; carrierName: string | null; carrierCode: string | null;
  operationalNotes: string | null; customerNotes: string | null; driverNotes: string | null;
  allocatedAdvanceAmount: number | null; financialMetadataComplete: boolean; canViewPayments: boolean; isLegacy: boolean;
}
export interface ExpenseAccountingList {
  items: ExpenseAccountingEntry[]; total: number; page: number; limit: number;
  totals: { amount: number; customerChargeAmount: number | null; receivedAmount: number | null; paidAmount: number | null; outstandingReceivable: number | null; outstandingPayable: number | null };
  unknownReceivableCount: number; unknownPayableCount: number; canViewPayments: boolean;
}
export interface ExpenseVoucher {
  reversal?: { valueDate: string; physicalReference: string; amount: number; reason: string | null; reversedById: number | null } | null;
  counterpartyName?: string | null; treasuryAccountName?: string | null;
  unappliedAmount?: number; paymentReceiptId?: number | null;
  id: number; code: string; direction: 'IN' | 'OUT'; treasuryAccountId: number; valueDate: string;
  physicalReference: string; amount: number; version: number; status: 'RECORDED' | 'REVERSED';
  counterpartyType: string; counterpartyId: number; createdById: number; createdAt: string; note: string | null;
  entries: Array<ExpenseSourceRef & { amount: number }>;
}
export interface ExpenseReconciliation {
  voidedAt?: string | null;
  id: number; code: string; opsUserId: number; from: string; to: string; amount: number; advanceAmount: number;
  initialDifference: number; paidAmount: number; refundedAmount: number; remainingDifference: number;
  entries: ExpenseSourceRef[]; createdAt: string; note: string | null;
  advances?: Array<{ advanceRequestId: number; amount: number; reason: string | null }>;
}
export interface TruckAccountantAssignment {
  truckId: number; truckPlate: string; accountantId: number | null; accountantName: string | null;
  version: number; assignedAt: string | null;
}

export interface ExpenseWorkRow {
  // shipmentCode carries a BUSINESS key (Số Booking/Bill) since the id-leak
  // purge — id-derived codes are banned from display text. null = neither
  // present → the UI renders '—'.
  id: string; tripId: number | null; shipmentId: number; shipmentCode: string | null;
  scheduledAt: string | null; customerName: string; routeName: string | null;
  factoryName: string | null;
  roadBreakdown: { roadAllowance: number | null; shiftAllowance: number | null; toll: number | null; extra: number | null; tollBasis: 'ACTUAL' | 'ESTIMATED' | 'UNKNOWN'; sharedWithTripId: number | null };
  containerNumber: string | null; containerType: string | null; classification: string | null;
  liftLocation: string | null; dropLocation: string | null; carrierName: string | null;
  vehiclePlate: string | null; driverName: string | null; operationalNotes: string | null; driverNotes: string | null;
  receivable: number | null; payable: number | null; road: number | null; entries: ExpenseAccountingEntry[];
}
export interface ExpenseWorkList {
  items: ExpenseWorkRow[]; total: number; page: number; limit: number;
  totals: { receivable: number | null; payable: number | null; road: number | null };
}
export const expenseAccountingCreateSchema = z.object({
  tripId: z.number().int().positive(), expenseTypeCode: z.string().trim().min(1).max(50),
  amount: expenseVndSchema.refine(v => v > 0), customerChargeAmount: expenseVndSchema,
  expenseDate: expenseDateSchema, costGroup: z.enum(EXPENSE_COST_GROUPS), feeName: z.string().trim().min(1).max(200),
  invoiceNumber: z.string().trim().max(100).nullable().optional(), invoiceDate: expenseDateSchema.nullable().optional(),
  payerKind: z.enum(['COMPANY', 'USER', 'SUPPLIER']), payerUserId: z.number().int().positive().nullable().optional(),
  supplierId: z.number().int().positive().nullable().optional(), note: z.string().max(2000).optional(), recoveryNote: z.string().max(1000).optional(),
  driverCostType: z.nativeEnum(DriverIncidentalCostType).optional(),
}).strict();
export type ExpenseAccountingCreate = z.infer<typeof expenseAccountingCreateSchema>;
