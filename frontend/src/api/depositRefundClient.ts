// Deposit-refund tracker API client — card 20260921_19 (THEO DÕI HOÀN CƯỢC
// CONTAINER). Thin helpers over the shared `api` wrapper for
// /accounting/deposits, mirroring the invoiceTrackingClient.ts idiom.

import { api } from '../lib/api';

export type DepositStatus = 'CHUA_HOAN_CUOC' | 'DA_HOAN_CUOC';

/** SIL-764 (id 885) — Phân loại trên cùng bảng hoàn cược. */
export type DepositCategory = 'CUOC_CONTAINER' | 'TAM_THU_SUA_CHUA';

export const DEPOSIT_CATEGORY_LABELS: Record<DepositCategory, string> = {
  CUOC_CONTAINER: 'Cược container',
  TAM_THU_SUA_CHUA: 'Tạm thu sửa chữa',
};

export interface DepositTrackerRow {
  id: number;
  shipmentId: number | null;
  billNumber: string;
  customerName: string;
  carrierName: string;
  depositAmount: string;
  /** Ngày cược — intake pre-stamps the VN day the row landed; KT corrects. */
  depositDate: string | null;
  cvSubmittedDate: string | null;
  expectedRefundDate: string | null;
  status: DepositStatus;
  /** SIL-764 — Phân loại (Cược container | Tạm thu sửa chữa). */
  category: DepositCategory;
  /** SIL-1061 — số đã hoàn từng phần + ngày nhận thực tế (NULL = chưa ghi nhận). */
  recoveredAmount: string | null;
  refundReceivedDate: string | null;
  refundPostedAt: string | null;
  note: string | null;
  createdAt: string;
}

export interface DepositTrackerWarnings {
  cvOverdueCount: number;
  unrefundedTotal: number;
}

export interface DepositTrackerListResponse {
  items: DepositTrackerRow[];
  total: number;
  warnings: DepositTrackerWarnings;
}

export async function listDepositTrackers(from?: string, to?: string, status?: DepositStatus, category?: DepositCategory): Promise<DepositTrackerListResponse> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (status) params.set('status', status);
  // SIL-764 — lọc theo phân loại.
  if (category) params.set('category', category);
  const qs = params.toString();
  return api.get<DepositTrackerListResponse>(`/accounting/deposits${qs ? `?${qs}` : ''}`);
}

/** "Thêm cược" typeahead: match lots by the LAST FOUR DIGITS of Bill/Booking. */
export interface BillSuggestion {
  shipmentId: number;
  billNumber: string | null;
  bookingRef: string | null;
  billDisplay: string;
  carrierName: string | null;
  customerName: string;
  existingTrackerCount: number;
}

export async function searchBillSuggestions(q: string): Promise<BillSuggestion[]> {
  const result = await api.get<{ items: BillSuggestion[] }>(`/accounting/deposits/bill-suggestions?q=${encodeURIComponent(q)}`);
  return result.items;
}

export async function createDepositTracker(body: {
  billNumber: string; customerName: string; carrierName: string; depositAmount: number | string;
  /** Set when the row came from the Bill typeahead, so the tracker links the lot. */
  shipmentId?: number | null;
  cvSubmittedDate?: string | null; expectedRefundDate?: string | null; note?: string | null;
  depositDate?: string | null; status?: DepositStatus;
  /** SIL-764 — Phân loại; omitted falls to the server default CUOC_CONTAINER. */
  category?: DepositCategory;
}): Promise<DepositTrackerRow> {
  return api.post<DepositTrackerRow>('/accounting/deposits', body);
}

export async function updateDepositTrackerDates(id: number, body: {
  /** SIL-878 — Ngày cược rides the same edit dialog. */
  depositDate?: string | null;
  cvSubmittedDate?: string | null; expectedRefundDate?: string | null; note?: string | null; depositAmount?: number | string;
  /** SIL-764 — Phân loại rides the same edit dialog. */
  category?: DepositCategory;
  /** SIL-1061 — số đã hoàn từng phần + ngày nhận thực tế. */
  recoveredAmount?: number | string | null;
  refundReceivedDate?: string | null;
}): Promise<DepositTrackerRow> {
  return api.patch<DepositTrackerRow>(`/accounting/deposits/${id}/dates`, body);
}

/** SIL-1061 — the tick records the amount actually received (default on the
 *  server = everything still outstanding) and the day it landed. */
export async function markDepositRefunded(id: number, opts: {
  expectedDepositAmount?: number;
  recoveredAmount?: number;
  refundReceivedDate?: string;
} = {}): Promise<DepositTrackerRow> {
  const body: Record<string, unknown> = {};
  if (opts.expectedDepositAmount !== undefined) body.expectedDepositAmount = opts.expectedDepositAmount;
  if (opts.recoveredAmount !== undefined) body.recoveredAmount = opts.recoveredAmount;
  if (opts.refundReceivedDate !== undefined) body.refundReceivedDate = opts.refundReceivedDate;
  return api.post<DepositTrackerRow>(`/accounting/deposits/${id}/refund`, body);
}
