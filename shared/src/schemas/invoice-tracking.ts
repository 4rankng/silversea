import { z } from 'zod';
import { partialUpdateSchema } from './partial-update';
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

/** SIL-762 — trạng thái hiển thị của dòng: chưa có số hóa đơn = "Chưa lấy HĐ"
 *  (đồng bộ tự động từ lô [Kết hợp], kế toán chưa ghi nhận hóa đơn). */
export const INVOICE_TRACKING_PENDING_INVOICE_LABEL = 'Chưa lấy HĐ';

/** SIL-762 — công thức tự động cột Chênh lệch (đè luật cũ "invoice − trả"):
 *  Chênh lệch = Số tiền thu − Số tiền trả − Số tiền trả KH. Số dư này phản
 *  ánh lợi nhuận từ việc xử lý hóa đơn ngoài của công ty. */
export const INVOICE_TRACKING_DIFF_FORMULA = 'Số tiền thu − Số tiền trả − Số tiền trả KH';

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

// PATCH shape — zod v4 applies create-time defaults inside bare `.partial()`
// (v3 left omitted keys out), which would reset `progress` to 'CHUA_GUI' on
// every PATCH that omits it; strip the defaults explicitly instead.
// SIL-762 adds `noInvoice` ("Không lấy hóa đơn") and `hidden` (Lưu và Ẩn /
// Bỏ ẩn) — flags only the office staff may flip, orthogonal to the invoice
// facts; `hidden: true` stamps hiddenAt/hiddenBy, `false` clears the hide.
export const invoiceTrackingPatchSchema = partialUpdateSchema(
  invoiceTrackingCreateSchema.omit({ shipmentId: true, tripId: true }).extend({
    noInvoice: z.boolean().optional(),
    hidden: z.boolean().optional(),
  }),
);

export const invoiceTrackingRowSchema = z.object({
  id: z.number().int().positive(),
  shipmentId: z.number().int().positive(),
  /** SIL-762 — null trên dòng tự đồng bộ (chưa phát sinh chuyến). */
  tripId: z.number().int().positive().nullable(),
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
   *  NULL on every pre-card row. SIL-762 supersedes that card's display rule:
   *  `difference` is now `invoiceAmount − supplierPayment − comAmount`
   *  (Số tiền thu − Số tiền trả − Số tiền trả KH). */
  comAmount: moneyString.nullable(),
  comNote: z.string().nullable(),
  invoiceSentAt: z.string().nullable(),
  note: z.string().nullable(),
  progress: z.enum(INVOICE_TRACKING_PROGRESS),
  expenseDate: z.string(),
  expenseId: z.number().int().positive().nullable(),
  // ── SIL-762 — 21-cột kết hợp: dữ liệu lô đọc LIVE từ shipments/customers,
  //    không snapshot (lô sửa Bill/hãng tàu thì bảng phản ánh ngay).
  /** Ngày vận chuyển của lô (shipments.expectedDeliveryDate); fallback hiển
   *  thị là expenseDate của dòng khi lô chưa chốt ngày. */
  transportDate: z.string().nullable(),
  /** Số Booking (lô xuất) — cột "Bill / Số tờ khai". */
  bookingRef: z.string().nullable(),
  /** Số Bill / tờ khai (lô nhập). */
  blNumber: z.string().nullable(),
  /** Nhà máy của lô. */
  factoryName: z.string().nullable(),
  /** Hãng tàu của lô. */
  shippingLineName: z.string().nullable(),
  /** Mã khách hàng (customers.code). */
  customerCode: z.string().nullable(),
  /** Số ĐNTT (đề nghị thanh toán — ops_settlements.code) của các khoản OPS
   *  đã chốt settlement cho lô này; distinct, giữ thứ tự hiện gặp. */
  dnttNumbers: z.array(z.string()),
  /** Dòng máy đồng bộ từ lô [Kết hợp] (sync_source='AUTO_COMBINED'). */
  isAutoSynced: z.boolean(),
  /** "Không lấy hóa đơn" đã tích (nút Lưu và Ẩn). */
  noInvoice: z.boolean(),
  /** Thời điểm ẩn khỏi danh sách làm việc; null = đang hiện. */
  hiddenAt: z.string().nullable(),
}).strict();

export type InvoiceTrackingCreateInput = z.infer<typeof invoiceTrackingCreateSchema>;
export type InvoiceTrackingPatchInput = z.infer<typeof invoiceTrackingPatchSchema>;
export type InvoiceTrackingRow = z.infer<typeof invoiceTrackingRowSchema>;
