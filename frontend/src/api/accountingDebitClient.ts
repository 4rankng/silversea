// Card 20260921_21 — KẾ HOẠCH ĐIỀU ĐỘNG TỔNG HỢP (accounting chốt-debit CORE)
// client. Types mirror the service response (money fields string|null —
// Chưa xác định, never a fabricated 0).
import { api } from '../lib/api';

export interface AccountingDebitBoardThu {
  cuocThu: string | null;
  lachHuyen: string | null;
  phuPs: string | null;
  phatSinhCus: string | null;
  tongThu: string | null;
}

export interface AccountingDebitBoardTra {
  cuocTraDv: string | null;
  lachHuyenDv: string | null;
  phatSinhDv: string | null;
  tong1: string | null;
  phiRu: string | null;
}

export interface AccountingDebitBoardRow {
  shipmentId: number;
  code: string | null;
  customerName: string | null;
  customerId: number | null;
  carrierKeys: string[];
  ngay: string | null;
  billOrBooking: string | null;
  /** K3.61 — số tờ khai của lô, gộp cả hai store (per-cont attribute trước,
   *  entity rows sau, dedup): display key thứ hai ngay sau Bill/Booking.
   *  Optional so a rolling deployment can lag the wire: absent → ô Số
   *  Bill/Book chỉ hiện ref như trước. */
  customsNumber?: string | null;
  containers: string[];
  phanXe: string[];
  /** SIL-838 — nhà máy/kho hàng + tuyến dưới tên KH. Optional so a rolling
   *  deployment can lag the board wire without breaking the cell. */
  factoryName?: string | null;
  routeName?: string | null;
  /** SIL-838 — BKS thực từ trip (đã lọc biển trùng nhãn phân xe). FE lật
   *  tới `lcl.actualTruckNo` trước, plates là fallback + nguồn cho FCL. */
  truckPlates?: string[];
  /** Ticket 18/11 Task 2.4 — BKS báo khách (xe ảo) at TOP level: the BE
   *  board projection already carries `lot.billingTruckNo`; the Debit Note
   *  preview prints it per row (100% BKS báo khách). Optional so a rolling
   *  deployment can lag the wire. */
  billingTruckNo?: string | null;
  /** FB-094 — LCL grouping facts (null on FCL/ungrouped rows). */
  lcl?: {
    label: string;
    actualTruckNo: string | null;
    billingTruckNo: string | null;
    ghépCùngRef: string | null;
    /** Card 211026024348 — the REV group id behind the row's "Tách nhóm"
     *  action (null = not in a rev group). Optional so a rolling deployment
     *  can lag the board wire without breaking the cell. */
    revGroupId?: string | null;
    /** SIL-191 (QA R42) — the COST (ghép trả ĐV) group id. The QA's merged
     *  lots were cost-merged, where revGroupId is null and only the
     *  ghépCùngRef fallback named the group; the strip's "Tách nhóm" reads
     *  this to unmerge the RIGHT dimension. Optional for the same rolling
     *  deployment reason. */
    costGroupId?: string | null;
  } | null;
  thu: AccountingDebitBoardThu;
  tra: AccountingDebitBoardTra;
  /** K2.23 (SIL-1084) — the PRE-override engine/contract value of the Cước
   *  thu cell, rendered beside the input for đối chiếu (null = Chưa xác định,
   *  never a fabricated 0); the FE reason-dialog compares against it.
   *  Optional so a rolling deployment can lag the wire without breaking the
   *  cell (absent → no comparison line, plain SIL-805 save). */
  cuocThuAuto?: string | null;
  /** The engine formula note behind cuocThuAuto (snapshot formula_text;
   *  "nhãn công thức nếu có" — null when the channel recorded none). */
  cuocThuAutoFormula?: string | null;
  /** SIL-771 — 'Chi phí ngoài' kế toán nhập; null = chưa nhập (đóng góp 0). */
  chiPhiNgoai: string | null;
  loiNhuan: string | null;
  /** SIL-773 — dòng đã 'Lưu - Phê duyệt từng dòng và ẩn' (ISO) hoặc null. */
  debitHiddenAt: string | null;
  ghiChu: string | null;
  adjustment: {
    status: 'NONE' | 'PENDING' | 'CONFIRMED';
    requestId: number | null;
    requestedAt: string | null;
    confirmedAt: string | null;
  };
  /** FB-094 (card 201026112300) — ACTIVE cost-lock time (ISO) or null: the
   *  consolidated debit-note export only accepts locked lots. */
  costLockedAt: string | null;
}

export async function listAccountingDebitBoard(params: {
  dateFrom?: string;
  dateTo?: string;
  /** SIL-773 — true = hiện cả các dòng đã 'Lưu - Phê duyệt từng dòng và ẩn'. */
  includeHidden?: boolean;
}): Promise<{ items: AccountingDebitBoardRow[]; total: number }> {
  const query = new URLSearchParams();
  if (params.dateFrom) query.set('dateFrom', params.dateFrom);
  if (params.dateTo) query.set('dateTo', params.dateTo);
  if (params.includeHidden) query.set('includeHidden', 'true');
  return api.get(`/accounting/debit-board?${query.toString()}`);
}

/** SIL-771 — lưu 'Chi phí ngoài' của một lô (null = xoá). Server chặn 409
 *  khi lô đã khóa chi phí / khóa sổ kế toán. Material-write middleware đòi
 *  Idempotency-Key: khóa xác định theo (lô, giá trị) — gõ lại cùng giá trị
 *  replay cùng kết quả, không tạo hiệu ứng thứ hai. */
export function setDebitExternalCost(input: {
  shipmentId: number;
  chiPhiNgoai: number | null;
}): Promise<{ shipmentId: number; chiPhiNgoai: string | null }> {
  return api.post('/accounting/debit-board/external-cost', input, {
    headers: { 'Idempotency-Key': `external-cost-${input.shipmentId}-${input.chiPhiNgoai ?? 'null'}` },
  });
}

/** SIL-805 — tên wire của 8 ô giá/chi phí kế toán sửa trực tiếp trên dòng. */
export type DebitRateField =
  | 'cuocThu' | 'lachHuyen' | 'phuPs' | 'phatSinhCus'
  | 'cuocTraDv' | 'lachHuyenDv' | 'phatSinhDv' | 'phiRu';

/** SIL-805 — lưu các ô giá/chi phí sửa trực tiếp trên dòng: mỗi key trong
 *  `rates` là MỘT ô được lưu (number nguyên VND). SIL-864 — `containerId`
 *  nhắm đúng dòng container (FCL ≥2 conts); omitted = dòng baseline cấp lô.
 *  Server chặn 409 khi lô đã khóa chi phí / khóa sổ kế toán; cùng khóa
 *  (lô, container, các cặp field=giá trị đã sort) replay cùng kết quả. */
export function setDebitRateOverrides(input: {
  shipmentId: number;
  containerId?: number | null;
  rates: Partial<Record<DebitRateField, number | null>>;
  /** K2.23 (SIL-1084) — the mandatory grounds the reason dialog collects for
   *  a Cước-thu edit differing from the engine/contract price; the service
   *  stores it verbatim in the DEBIT_RATE_OVERRIDE_SET audit. NOT part of
   *  the Idempotency-Key: same rates = same end state = the replay law. */
  reason?: string;
}): Promise<{ shipmentId: number; containerId: number | null; rates: Record<DebitRateField, number | null> }> {
  const pairs = Object.entries(input.rates)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, value]) => `${field}=${value}`);
  return api.post('/accounting/debit-board/rates', input, {
    headers: { 'Idempotency-Key': `rate-override-${input.shipmentId}-${input.containerId ?? 'lot'}-${pairs.join('|')}` },
  });
}

/** SIL-773 — nút 'Lưu - Phê duyệt từng dòng và ẩn' theo selection: server
 *  ghi dấu debit_hidden_at/by; dòng rời danh sách tác nghiệp, bật
 *  includeHidden vẫn tra lại được lịch sử. Key cùng công thức FNV-1a của
 *  selection (createDebitNoteBatch precedent) — same selection replays same
 *  mark, không nhân bản. */
export function reconcileAndHideDebitLots(shipmentIds: number[]): Promise<{ hidden: number[] }> {
  const run = [...shipmentIds].sort((x, y) => x - y).join(',');
  let hash = 0x811c9dc5;
  for (let i = 0; i < run.length; i++) {
    hash ^= run.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return api.post('/accounting/debit-board/reconcile-hide', { shipmentIds }, {
    headers: { 'Idempotency-Key': `reconcile-hide-${shipmentIds.length}-${hash.toString(16)}` },
  });
}

// Card 20260923_12 — Chọn Debit settlement rounds (đợt chốt). Query key lives
// HERE, not in api/keys.ts, while that file is another lane's WIP surface.
export const DEBIT_SETTLEMENT_ROUNDS_KEY = ['accounting-debit-settlement-rounds'] as const;

export interface DebitSettlementRoundRow {
  id: number;
  customerId: number;
  customerName: string | null;
  direction: 'THU' | 'TRA';
  carrierKey: string;
  carrierLabel: string | null;
  periodKey: string;
  roundNo: number;
  dateFrom: string;
  dateTo: string;
  amount: string;
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  ghiChu: string | null;
  lotCount: number;
  createdAt: string;
}

export interface CreateSettlementRoundBody {
  shipmentIds: number[];
  dateFrom: string;
  dateTo: string;
  roundNo: number;
  month: number;
  year: number;
  direction: 'THU' | 'TRA';
  vatRate: 0 | 5 | 8 | 10;
  ghiChu?: string;
}

export async function listSettlementRounds(): Promise<{ items: DebitSettlementRoundRow[] }> {
  return api.get('/accounting/debit-board/settlement-rounds');
}

export async function createSettlementRound(body: CreateSettlementRoundBody): Promise<DebitSettlementRoundRow> {
  return api.post('/accounting/debit-board/settlement-rounds', body);
}

// Ticket 18/11 Task 2.4 (SIL-855) — bảng xem trước Xuất Debit Note của MỘT
// đợt: server computes the rows + 4 closing totals on the SAME frozen-lock
// basis the [Lưu] issuance uses, so preview ≡ Công nợ by construction.
export interface DebitNoteRoundPreviewItem {
  shipmentId: number;
  /** SIL-868 — the SỐ BILL/BOOKING identity; the internal SHP-* code never
   *  reaches the preview modal. */
  billOrBooking: string | null;
  customerName: string | null;
  /** BKS báo khách — THU rounds only; null on TRA (nhà xe) statements so the
   *  customer plate can never reach the payable ledger (SIL-1092, K6.32). */
  billingTruckNo: string | null;
  /** SIL-1092 (K6.32) — BKS THỰC của chuyến (own truck plate / external
   *  carrier plate, fallback ĐV actualTruckNo). */
  actualTruckNo: string | null;
  /** SIL-1092 (K6.32) — loại xe tính cước trả (cost vehicle class); null when
   *  the lot carries none — rendered '—', never inferred. */
  vehicleType: string | null;
  net: number;
  costLockedAt: string | null;
}

export interface DebitNoteRoundPreview {
  round: {
    id: number;
    roundNo: number;
    periodKey: string;
    direction: 'THU' | 'TRA';
    vatRate: number;
    customerName: string | null;
  };
  items: DebitNoteRoundPreviewItem[];
  totals: { net: number; tax: number; gross: number };
}

export async function getDebitNoteRoundPreview(roundId: number): Promise<DebitNoteRoundPreview> {
  return api.get(`/accounting/debit-board/settlement-rounds/${roundId}/debit-note-preview`);
}

export async function confirmRateAdjustments(requestIds: number[]): Promise<{ confirmed: number }> {
  return api.post('/accounting/debit-board/rate-adjustments/confirm', { requestIds });
}

export async function withdrawRateAdjustments(requestIds: number[]): Promise<{ withdrawn: number }> {
  return api.post('/accounting/debit-board/rate-adjustments/withdraw', { requestIds });
}
