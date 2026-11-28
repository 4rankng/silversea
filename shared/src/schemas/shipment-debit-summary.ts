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
  // Nhóm CUS team visibility (ticket 18/11 Task 1.2): absent/'false' = mặc
  // định chỉ lô của chính tài khoản CUS; 'true' mở rộng theo nhóm ACTIVE.
  team: z.enum(['true', 'false']).optional(),
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
  // ── SIL-1051 (K3.61) — the lot's per-container tờ khai pairs, container-id
  // order: each entry is ONE container (containerNumber) and ITS OWN per-cont
  // declaration attribute (null = that container carries none). A
  // shipment_declarations entity row is lot-level and maps to no container,
  // so only the per-cont store feeds these pairs; `customsNumber` stays the
  // merged lot key (per-cont first, entity after, dedup). Optional/nullable
  // like every late-added wire field: an older response drops it.
  containerDeclarations: z.array(z.object({
    containerNumber: z.string().nullable(),
    declarationNumber: z.string().nullable(),
  })).nullable().optional(),
  // ── CR-011.2 Q6 — the lot's live KẸP pair code (trips.active_trip_pair_id
  // of the lot's live trips; null = no active pair). The board renders the
  // "Mã cặp" chip and the exact-pair filter from it. Optional/nullable like
  // every late-added wire field: an older response drops it.
  pairId: z.number().int().positive().nullable().optional(),
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
  // Audit 2026-11-04 §2.2 (SIL-548 pattern): the lot's SAVED manual "Giá
  // cước thu khách" (the §4.1 field-2 negotiated override) over the same
  // channel the money boards read (`loadRevManualPriceByLot`) — the strip
  // seeds from it so a saved price survives a reopen. null = auto-trace.
  // Optional/nullable like every late-added wire field: an older response
  // drops it and the strip falls back to blank (auto).
  revFreightManual: moneyString.nullable().optional(),
  // What SS pays on the customer's behalf (CVC + Ops fees, trip expenses).
  chiHoTotal: moneyString.nullable(),
  receivableTotal: moneyString.nullable(),
  // ── SIL-776 REV2 (ticket-v2 Phần VI mục 2, 09/11/2026) — the flat board's
  // two sell columns, conserved so chiHoSellTotal + serviceSellTotal +
  // freightAuto sum to receivableTotal (knowns-sum; null = no data behind
  // either component, never a 0). Stripped of every cost measure by design:
  // cước trả vendor / tổng chi phí đầu vào / biên lợi nhuận NEVER ride this
  // board's columns, and the cost fields below are wire-null for the CUS
  // role (server-side strip in the producer).
  chiHoSellTotal: moneyString.nullable().optional(),
  serviceSellTotal: moneyString.nullable().optional(),
  // ── Redesign 23/10 (owner spec v2, "Chi hãng tàu" / "Chi nội địa") — the
  // two live components behind payableTotal, shipped separately so L1 can
  // render the cost split. SIL-1238 r2 (QA bounce build 61999831) — the row
  // law: known cost ROWS sum row by row, a row without a recorded amount
  // contributes nothing. Cước trả hãng = Σ known trip_carrier_info
  // .external_freight_cost rows (null when no trip carries one — an unpriced
  // trip never blanks its priced siblings); Chi nội địa = the lot's live ops
  // expense entries (null at zero rows). Same null law as payableTotal:
  // unknown stays null, never a 0.
  // Optional like the GP-01 measures — an older summary response simply
  // drops the columns' data instead of failing.
  carrierCostTotal: moneyString.nullable().optional(),
  opsCostTotal: moneyString.nullable().optional(),
  // TỔNG PHẢI TRẢ (ruling 2026-09-19; SIL-1238 r2 — K2.74 knowns-sum of the
  // rows above): Cước trả (CVC) + ops-entered expenses, summed over the
  // lot's KNOWN cost rows for locked and open lots alike. Null only when no
  // payable-side row is known — never a 0.
  payableTotal: moneyString.nullable(),
  // receivable − freight − chi hộ; null whenever any component is unknown.
  profit: moneyString.nullable(),
  // Debit-lock placeholder: the real debit lock ships with card _19's
  // persistence. Until then every lot reads OPEN.
  lockStatus: z.enum(['OPEN', 'LOCKED']),
  lockedAt: z.iso.datetime().nullable(),
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
  // ── SIL-478 (2026-10-25) — the phone row's meta line ("Bill · ngày · n
  // cont"). `deliveryDate` = the lot's expected delivery date (the same
  // edd the list orders and filters by); `containerCount` = Σ active trips'
  // container_count (non-deleted, non-CANCELED — physical containers on the
  // lot, not the chốt's fulfillment-only money scope) — except for LCL,
  // where SIL-601 (id 702, owner ruling 30/10/2026) counts the lot as exactly
  // ONE cont (1 lô cont 1 cont: never 0, never the Σ over trips). Both
  // nullable/optional
  // like every late-added wire field: an older response simply drops the
  // meta segment instead of failing.
  deliveryDate: z.string().nullable().optional(),
  containerCount: z.number().int().nonnegative().nullable().optional(),
  // 18/11 Task 1.2 — NV phụ trách: the lot's creator (users join on
  // shipments.createdBy). The CUS grid renders the name in team mode.
  // Optional/nullable like every late-added wire field.
  creatorName: z.string().nullable().optional(),
  creatorCode: z.string().nullable().optional(),
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
