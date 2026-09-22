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
  ngay: string | null;
  billOrBooking: string | null;
  containers: string[];
  phanXe: string[];
  thu: AccountingDebitBoardThu;
  tra: AccountingDebitBoardTra;
  loiNhuan: string | null;
  ghiChu: string | null;
  adjustment: {
    status: 'NONE' | 'PENDING' | 'CONFIRMED';
    requestId: number | null;
    requestedAt: string | null;
    confirmedAt: string | null;
  };
}

export async function listAccountingDebitBoard(params: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ items: AccountingDebitBoardRow[]; total: number }> {
  const query = new URLSearchParams();
  if (params.dateFrom) query.set('dateFrom', params.dateFrom);
  if (params.dateTo) query.set('dateTo', params.dateTo);
  return api.get(`/accounting/debit-board?${query.toString()}`);
}

export async function sendRateAdjustmentRequests(body: {
  shipmentIds: number[];
  ghiChu?: string;
}): Promise<{ requested: number[]; alreadyPending: number[]; locked: number[] }> {
  return api.post('/accounting/debit-board/rate-adjustments', body);
}

export async function confirmRateAdjustments(requestIds: number[]): Promise<{ confirmed: number }> {
  return api.post('/accounting/debit-board/rate-adjustments/confirm', { requestIds });
}

export async function withdrawRateAdjustments(requestIds: number[]): Promise<{ withdrawn: number }> {
  return api.post('/accounting/debit-board/rate-adjustments/withdraw', { requestIds });
}
