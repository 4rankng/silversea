import { z } from 'zod';
import { round2dp } from '../calculations/round';

// Card 20260921_18 — THEO DÕI HÓA ĐƠN KẾT HỢP. One tracking row per combined
// invoice against a lot's container trip; the supplier payment mirrors into
// trip_expenses as "Chi phí hóa đơn" (Chi phí khác bucket) and stays in sync.

export const INVOICE_TRACKING_PROGRESS = ['CHUA_GUI', 'CO_HD', 'GUI_HD'] as const;
export type InvoiceTrackingProgress = typeof INVOICE_TRACKING_PROGRESS[number];

export const INVOICE_TRACKING_PROGRESS_LABELS: Record<InvoiceTrackingProgress, string> = {
  CHUA_GUI: 'Chưa gửi',
  CO_HD: 'Có HĐ',
  GUI_HD: 'Gửi HĐ',
};

const moneyString = z.string().regex(/^-?\d+$/);

/** Card 2026-10-05_384 — COM (hoa hồng) is a MONEY input, and it is a SIBLING of
 *  `comNote`, never a reinterpretation of it: legacy rows carry real free text
 *  in `comNote` ("Đã trở 2%"), and a row that has only the note must stay
 *  readable. Same coercion style as `invoiceAmount`, rounded through the
 *  house `round2dp()` so a money input lands on the grid the wire expects. */
const comAmountInput = z.coerce.number().transform(round2dp).pipe(z.number().int().nonnegative());

export const invoiceTrackingCreateSchema = z.object({
  shipmentId: z.coerce.number().int().positive(),
  tripId: z.coerce.number().int().positive(),
  invoiceNumber: z.string().trim().min(1, 'Số hóa đơn là bắt buộc').max(50),
  invoiceAmount: z.coerce.number().int().nonnegative(),
  supplierPayment: z.coerce.number().int().nonnegative(),
  taxCode: z.string().trim().max(20).optional().nullable(),
  supplierName: z.string().trim().max(200).optional().nullable(),
  comAmount: comAmountInput.optional().nullable(),
  comNote: z.string().trim().max(200).optional().nullable(),
  invoiceSentAt: z.string().date().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  progress: z.enum(INVOICE_TRACKING_PROGRESS).default('CHUA_GUI'),
  expenseDate: z.string().date().optional(),
}).strict();

export const invoiceTrackingPatchSchema = invoiceTrackingCreateSchema
  .omit({ shipmentId: true, tripId: true })
  .partial();

export const invoiceTrackingRowSchema = z.object({
  id: z.number().int().positive(),
  shipmentId: z.number().int().positive(),
  tripId: z.number().int().positive(),
  containerNumber: z.string().nullable(),
  /** Card 20261005_383 — DERIVED, not a stored column: the container type name
   *  of the same first container that produced `containerNumber`. Null when
   *  the trip has no container or the container has no type. */
  containerType: z.string().nullable(),
  /** Card 20261005_383 — `shipments.tradeDirection` verbatim (IMPORT/EXPORT);
   *  the board maps it through TRADE_DIRECTION_LABELS. Null when unset. */
  tradeDirection: z.enum(['IMPORT', 'EXPORT']).nullable(),
  shipmentCode: z.string().nullable(),
  customerName: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceAmount: moneyString,
  supplierPayment: moneyString,
  difference: moneyString,
  taxCode: z.string().nullable(),
  supplierName: z.string().nullable(),
  /** Card 2026-10-05_384 — the COM amount as an integer string (moneyString),
   *  NULL on every pre-card row. The amount is DISPLAY-ONLY: `difference` below
   *  stays `invoiceAmount − supplierPayment` and never folds COM in. */
  comAmount: moneyString.nullable(),
  comNote: z.string().nullable(),
  invoiceSentAt: z.string().nullable(),
  note: z.string().nullable(),
  progress: z.enum(INVOICE_TRACKING_PROGRESS),
  expenseDate: z.string(),
  expenseId: z.number().int().positive().nullable(),
}).strict();

export type InvoiceTrackingCreateInput = z.infer<typeof invoiceTrackingCreateSchema>;
export type InvoiceTrackingPatchInput = z.infer<typeof invoiceTrackingPatchSchema>;
export type InvoiceTrackingRow = z.infer<typeof invoiceTrackingRowSchema>;
