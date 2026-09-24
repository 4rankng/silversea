import { z } from 'zod';

// Chi phí - Quyết toán (Debit CUS) Lớp 1 — per-lot revenue rollup.
// PRD money-state separation (O2C §7): phải thu ≠ đã thu ≠ đã khóa; every
// money field is nullable and null means "chưa xác định" — the UI must never
// render an unknown as 0.

const moneyString = z.string().regex(/^-?\d+(?:\.\d+)?$/);

export const shipmentDebitSummaryQuerySchema = z.object({
  customerId: z.coerce.number().int().positive('Khách hàng là bắt buộc'),
  // "Ngày giao hàng" filter — the lot's expected delivery date (edd family,
  // PRD OpsVanHanh §3.1), not an appointment date.
  deliveryDateFrom: z.string().date().optional(),
  deliveryDateTo: z.string().date().optional(),
  lockStatus: z.enum(['ALL', 'OPEN', 'LOCKED']).optional().default('ALL'),
});

export const shipmentDebitSummaryItemSchema = z.object({
  shipmentId: z.number().int().positive(),
  code: z.string().nullable(),
  customerName: z.string().nullable(),
  factoryName: z.string().nullable(),
  factoryAddress: z.string().nullable(),
  billOrBookNumber: z.string().nullable(),
  customsNumber: z.string().nullable(),
  documentsSummary: z.string().nullable(),
  // Auto freight: the freight-rate snapshot totals (system-calculated), not
  // the negotiated debit-note override.
  freightAuto: moneyString.nullable(),
  // What SS pays on the customer's behalf (CVC + Ops fees, trip expenses).
  chiHoTotal: moneyString.nullable(),
  receivableTotal: moneyString.nullable(),
  // TỔNG PHẢI TRẢ (ruling 2026-09-19): Cước trả (CVC) + ops-entered
  // expenses. Null whenever either component is unknown — never a 0.
  payableTotal: moneyString.nullable(),
  // receivable − freight − chi hộ; null whenever any component is unknown.
  profit: moneyString.nullable(),
  // Debit-lock placeholder: the real debit lock ships with card _19's
  // persistence. Until then every lot reads OPEN.
  lockStatus: z.enum(['OPEN', 'LOCKED']),
  lockedAt: z.string().datetime().nullable(),
});

export const shipmentDebitSummaryResponseSchema = z.object({
  items: z.array(shipmentDebitSummaryItemSchema),
  total: z.number().int().nonnegative(),
  // Card 20260924_2 — shadow totals: fees on trips with fulfillment_id NULL
  // render nowhere in Lớp 2 (lotTrips join shipment_fulfillments), so they
  // stay OUT of the chốt-able totals. Silent exclusion is banned — the
  // excluded money surfaces as this one explicit line (N trips + X ₫).
  excludedCount: z.number().int().nonnegative(),
  excludedSum: moneyString,
});

export type ShipmentDebitSummaryQuery = z.infer<typeof shipmentDebitSummaryQuerySchema>;
export type ShipmentDebitSummaryItem = z.infer<typeof shipmentDebitSummaryItemSchema>;
export type ShipmentDebitSummaryResponse = z.infer<typeof shipmentDebitSummaryResponseSchema>;
