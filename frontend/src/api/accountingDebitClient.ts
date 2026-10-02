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
