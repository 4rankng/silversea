import { z } from 'zod';

// Chi phí - Quyết toán (Debit CUS) Lớp 1 — per-lot revenue rollup.
// PRD money-state separation (O2C §7): phải thu ≠ đã thu ≠ đã khóa; every
// money field is nullable and null means "chưa xác định" — the UI must never
// render an unknown as 0.

const moneyString = z.string().regex(/^-?\d+(?:\.\d+)?$/);

// Card _202: the customer is the page's PRIMARY axis, not a filter — an empty
// `customerId` (or an absent one) means "every customer", which is what the
// screen shows before anyone picks one. An empty string arrives from a
// hand-edited URL, so it is normalised to absent rather than coerced to 0.
const optionalCustomerId = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.number().int().positive('Khách hàng không hợp lệ').optional(),
);

export const shipmentDebitSummaryQuerySchema = z.object({
  customerId: optionalCustomerId,
  // "Ngày giao hàng" filter — the lot's expected delivery date (edd family,
  // PRD OpsVanHanh §3.1), not an appointment date.
  deliveryDateFrom: z.string().date().optional(),
  deliveryDateTo: z.string().date().optional(),
  lockStatus: z.enum(['ALL', 'OPEN', 'LOCKED']).optional().default('ALL'),
});

export const shipmentDebitSummaryItemSchema = z.object({
  // The lot's own customer. The list can span customers, so the L2 workspace
  // keys its fee catalog off THIS row, never off the page's filter.
  customerId: z.number().int().positive().nullable(),
  shipmentId: z.number().int().positive(),
  code: z.string().nullable(),
  customerName: z.string().nullable(),
  factoryName: z.string().nullable(),
  factoryAddress: z.string().nullable(),
  billOrBookNumber: z.string().nullable(),
  customsNumber: z.string().nullable(),
  documentsSummary: z.string().nullable(),
  // Auto freight: the freight-rate snapshot totals (system-calculated), not
  // the negotiated debit-note override. F-2 ruling (b): a REV-grouped or
  // override-stamped lot reads the trip_financial_state.revenue override
  // channel instead (merged 100%/0₫ law).
  freightAuto: moneyString.nullable(),
  // F-2: the override reason stamp behind freightAuto when the override
  // channel produced it ("Ghép cước cùng Bill X", FB-095 re-stamps, M2.1
  // operator reasons) — the spec §3.2 "chú thích nhỏ bên dưới" the money
  // cell. null when the snapshot channel produced the value.
  freightOverrideReason: z.string().nullable(),
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
  // ── GP-01 (2026-10-23-gomhang-polish) — the lot's own cargo measures, for
  // the CUS merge bar's "Tổng X tấn | Y CBM" (parity with the ĐV bar).
  // Decimal strings like every measure on the wire (kg / CBM); null = the lot
  // entered none — the bar drops that component rather than inventing a 0.
  cargoWeightKg: z.string().nullable(),
  cargoVolumeCbm: z.string().nullable(),
  // ── FB-092/093 LCL grouping facts ────────────────────────────────────────
  cargoMode: z.enum(['FCL', 'LCL']).nullable(),
  costGroupId: z.string().nullable(),
  costGroupOrder: z.number().int().nullable(),
  revGroupId: z.string().nullable(),
  revGroupOrder: z.number().int().nullable(),
  // Group member count (either dimension; null when ungrouped).
  costGroupMemberCount: z.number().int().nullable(),
  revGroupMemberCount: z.number().int().nullable(),
  actualTruckNo: z.string().nullable(),
  billingTruckNo: z.string().nullable(),
  // Loại xe tính cước — trả ĐV (cost) / thu khách (rev); codes like '5T'.
  costVehicleClassCode: z.string().nullable(),
  revVehicleClassCode: z.string().nullable(),
  // The principal lot's Số Bill/Số Booking for "Ghép cước cùng Bill X" —
  // null when ungrouped or when the row IS the principal.
  revGroupPrincipalRef: z.string().nullable(),
  costGroupPrincipalRef: z.string().nullable(),
});

// Case 2026-10-17 — the L1 shadow line must NAME what it excludes: one entry
// per fulfillment-NULL trip in the same filtered lot scope as the list.
// `lotLabel` mirrors the row's own identity chain (Số Bill / Số Booking →
// Số tờ khai → '—'); `feeSum` is that trip's positive buy-sum, so the entries
// sum to `excludedSum`.
export const excludedTripSchema = z.object({
  tripId: z.number().int().positive(),
  tripCode: z.string().nullable(),
  shipmentId: z.number().int().positive(),
  lotLabel: z.string(),
  customerName: z.string().nullable(),
  departureDate: z.string().nullable(),
  feeSum: moneyString,
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
  // …and the line can expand to the trips themselves (case 2026-10-17).
  excludedTrips: z.array(excludedTripSchema),
});

export type ShipmentDebitSummaryQuery = z.infer<typeof shipmentDebitSummaryQuerySchema>;
export type ShipmentDebitSummaryItem = z.infer<typeof shipmentDebitSummaryItemSchema>;
export type ShipmentDebitSummaryResponse = z.infer<typeof shipmentDebitSummaryResponseSchema>;
