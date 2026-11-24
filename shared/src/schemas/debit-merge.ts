import { z } from 'zod';
import { debitDetailUnattachedTripSchema } from './shipment-debit-detail';

// Task 2.3 (18/11) — Bảng Ghép bộ Debit: ONE 6-column-group reconciliation
// grid shared by Kế toán (/accounting/ghep-bo-debit) and CUS
// (/shipments-debit). One row per LÔ (lot); containers[] ride as child lines
// (Số cont | Loại cont repeat per line in the UI; every money figure stays
// LOT-level).
//
// Money law (debit-summary precedent): every money field is a decimal STRING
// and null means "chưa xác định" — the grid renders the cell EMPTY, never a
// fabricated 0. SIL-776 REV2: the wire carries NO giá vốn by construction —
// only the sell/thu-khách side and the chi-hộ rows the CUS settlement detail
// already shows; carrier cost / ops cost / profit never join this contract.

const moneyString = z.string().regex(/^-?\d+(?:\.\d+)?$/);

const optionalCustomerId = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.number().int().positive('Khách hàng không hợp lệ').optional(),
);

export const debitMergeQuerySchema = z.object({
  customerId: optionalCustomerId,
  // Nhóm CUS team visibility (ticket 18/11 Task 1.2): absent/'false' = chỉ lô
  // của chính tài khoản CUS; 'true' mở rộng theo nhóm ACTIVE (same law as
  // shipment-debit-summary). Staff roles are never scoped.
  team: z.enum(['true', 'false']).optional(),
});

export const debitMergeContainerSchema = z.object({
  id: z.number().int().positive(),
  containerNumber: z.string().nullable(),
  containerType: z.string().nullable(),
});

/** One invoiced chi-hộ fee line (group 4 sub-groups). `invoiceNumber` = Số
 *  HĐ (nullable — an entered row without the number yet); `amount` = Tiền /
 *  Số tiền (the customer charge); `actualAmount` = Thực chi (what was
 *  actually paid — only the nâng/hạ sub-groups carry it); `feeName` = Tên
 *  phí (only the Phí khác sub-group).
 *  SIL-883 (3.1) — `pending` = the fee saved but not yet accountant-approved
 *  (the accounting-source link has no confirm stamp): the grid renders the
 *  line red until Kế toán duyệt; approved rows omit it (black). */
export const debitMergeInvoiceFeeSchema = z.object({
  invoiceNumber: z.string().nullable(),
  amount: moneyString,
  actualAmount: moneyString.nullable().optional(),
  feeName: z.string().nullable().optional(),
  pending: z.boolean().optional(),
});

/** Group 4 — PHÍ CHI HỘ (Có hóa đơn): 4 sub-groups mapped from the expense
 *  type catalog's settlement `category` (never name matching — a rename must
 *  not move money between groups):
 *    csht  ← category CSHT                       (Số HĐ | Tiền)
 *    lift  ← category LIFT  (nâng-cont/lưu kho hàng lẻ)  (Số HĐ | Tiền | Thực chi)
 *    drop  ← category DROP  (hạ-cont/bốc xếp)            (Số HĐ | Tiền | Thực chi)
 *    other ← everything else incl. KHAC/HQGS/PHAT_SINH/null (Số HĐ | Số tiền | Tên phí)
 */
export const debitMergeChiHoSchema = z.object({
  csht: z.array(debitMergeInvoiceFeeSchema),
  lift: z.array(debitMergeInvoiceFeeSchema),
  drop: z.array(debitMergeInvoiceFeeSchema),
  other: z.array(debitMergeInvoiceFeeSchema),
});

/** Group 5 — PHÍ KHÔNG HÓA ĐƠN: the two no-invoice Ops fee families, read
 *  from the ops expense rows' cost groups (Giao nhận Ops = OPS_REGULAR,
 *  Phát sinh Ops = OPS_INCIDENTAL — the canonical names behind the ticket's
 *  'Phí GN OP TC' / 'Phí PS OP TC' abbreviations). Per family the wire
 *  carries BOTH sides of the card-20260921_5 pair: `*Fee` = Phí (the
 *  entry's amount) and `*Paid` = Thực thu (the negotiated
 *  customerChargeAmount sum); null = no known rows of that side — unknown,
 *  never a fabricated 0. `fees` lists the named rows (Tên phí column). */
export const debitMergeNoInvoiceSchema = z.object({
  gnFee: moneyString.nullable(),
  gnPaid: moneyString.nullable(),
  psFee: moneyString.nullable(),
  psPaid: moneyString.nullable(),
  /** SIL-883 (3.1) — per-cell pending tone: true when ANY contributing entry
   *  of that side is still awaiting Kế toán duyệt (cell renders red). */
  gnFeePending: z.boolean().optional(),
  gnPaidPending: z.boolean().optional(),
  psFeePending: z.boolean().optional(),
  psPaidPending: z.boolean().optional(),
  /** SIL-896 round 11 — `side` names the fee's family ('gn' = Phí GN OP TC,
   *  'ps' = Phí PS OP TC) so the money cells render ONE line per fee; a
   *  name-only line (unknown family) omits it. */
  fees: z.array(z.object({ name: z.string().nullable(), amount: moneyString, side: z.enum(['gn', 'ps']).optional(), pending: z.boolean().optional() })),
});

/** Group 6 — KIỂM SOÁT. `tongTc` = Tổng thực thu khách, the summary's
 *  receivable law (receivableDetermined/receivableDisplayValue) — the one
 *  control figure the debit assembly must match. `lockStatus` drives the
 *  Khóa lô / Chọn Debit actions (costs complete = active cost lock, the
 *  debit-note export eligibility law). */
export const debitMergeControlSchema = z.object({
  tongTc: moneyString.nullable(),
  lockStatus: z.enum(['OPEN', 'LOCKED']),
  lockedAt: z.iso.datetime().nullable(),
  /** SIL-883 (3.2) — how many of the lot's saved fees still await Kế toán
   *  duyệt. >0 hard-blocks Khóa lô / Chọn Debit / Xuất Debit Note on the FE
   *  and the matching BE guards 409 with the same count. */
  pendingFeeCount: z.number().int().nonnegative().optional(),
});

export const debitMergeItemSchema = z.object({
  shipmentId: z.number().int().positive(),
  code: z.string().nullable(),
  customerId: z.number().int().positive().nullable(),
  customerName: z.string().nullable(),
  factoryName: z.string().nullable(),
  routeName: z.string().nullable(),
  // The lot's expected delivery date — group 1's Ngày column.
  deliveryDate: z.string().nullable(),
  billOrBookNumber: z.string().nullable(),
  // NV phụ trách (18/11 Task 1.2): the lot's creator, rendered by the CUS
  // grid in team mode. Optional per the late-added wire convention.
  creatorName: z.string().nullable().optional(),
  creatorCode: z.string().nullable().optional(),
  containers: z.array(debitMergeContainerSchema),
  // Group 3 — CƯỚC PHẢI THU: the chot-debit board's thu cells
  // (Cước | Lạch Huyện | Phụ phí | Phát sinh | Tổng), same channels +
  // accountant rate overrides.
  revenue: z.object({
    cuoc: moneyString.nullable(),
    // F-2: the override stamp behind `cuoc` ("Ghép cước cùng Bill X") — the
    // merge-tag law renders the visible «Ghép thu cước cùng Lô 1» marker on
    // a rev-group MEMBER's cước cell with this as the tooltip. null = the
    // snapshot channel produced the value.
    cuocReason: z.string().nullable().optional(),
    lachHuyen: moneyString.nullable(),
    phuPhi: moneyString.nullable(),
    phatSinh: moneyString.nullable(),
    tong: moneyString.nullable(),
  }),
  chiHo: debitMergeChiHoSchema,
  noInvoice: debitMergeNoInvoiceSchema,
  control: debitMergeControlSchema,
  // FB-092/093 LCL grouping facts (the merge-tag law + ghép-cùng notes).
  // Optional per the late-added wire convention; null on FCL/ungrouped rows.
  cargoMode: z.enum(['FCL', 'LCL']).nullable().optional(),
  revGroupId: z.string().nullable().optional(),
  revGroupOrder: z.number().int().nullable().optional(),
  revGroupMemberCount: z.number().int().nullable().optional(),
  // SIL-944 (K9.19) — the dedicated 'Thông số' cell facts for an LCL lot: the
  // 'Lẻ · Thu: X · Trả: Y' label (vehicle-size-class codes, FB-094 law) plus
  // the group principal ref behind 'Ghép cùng Bill X' (null on the principal
  // itself). Optional per the late-added wire convention; null/absent on
  // FCL/ungrouped rows.
  lclParams: z.object({
    label: z.string(),
    ghepCungRef: z.string().nullable(),
  }).nullable().optional(),
  // SIL-974 (K10.54 §10.8.6) — the lot's ngoài-chốt trips (fulfillment-NULL
  // work): a display-only read-only section under the debit grid, hidden when
  // the lot has none, their money excluded from every chốt total by
  // construction. Same wire shape as the per-lot debit-detail section (card
  // 20260924_3) — never re-declared. Optional per the late-added wire
  // convention.
  unattachedTrips: z.array(debitDetailUnattachedTripSchema).optional(),
});

export const debitMergeResponseSchema = z.object({
  items: z.array(debitMergeItemSchema),
  total: z.number().int().nonnegative(),
});

export type DebitMergeQuery = z.infer<typeof debitMergeQuerySchema>;
export type DebitMergeContainer = z.infer<typeof debitMergeContainerSchema>;
export type DebitMergeInvoiceFee = z.infer<typeof debitMergeInvoiceFeeSchema>;
export type DebitMergeChiHo = z.infer<typeof debitMergeChiHoSchema>;
export type DebitMergeNoInvoice = z.infer<typeof debitMergeNoInvoiceSchema>;
export type DebitMergeControl = z.infer<typeof debitMergeControlSchema>;
export type DebitMergeItem = z.infer<typeof debitMergeItemSchema>;
export type DebitMergeResponse = z.infer<typeof debitMergeResponseSchema>;
