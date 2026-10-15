import type {
  ExpenseAccountingEntry, ExpenseAccountingList, ExpenseAccountingUpdate,
  ExpenseListQuery, ExpenseSourceRef, ExpenseVoucherInput, ExpenseVoucher,
  ExpenseReconciliationInput, ExpenseReconciliation, ExpenseWorkList, ExpenseAccountingCreate, ExpenseAccountingCreateBatch, TruckAccountantAssignment,
} from '@tingting/shared';
import { api, fileCommandFingerprint } from '../lib/api';

export interface ExpenseAccountingCatalog {
  staff: Array<{ id: number; name: string; role?: string }>;
  accounts: Array<{ id: number; name: string; fundCode: 'COMPANY' | 'TM' | null }>;
  accountants: Array<{ id: number; name: string }>;
  opsUsers: Array<{ id: number; name: string }>;
  advances: Array<{ id: number; opsUserId: number; amount: number; remainingAmount: number; date: string; name: string | null }>;
  pendingAdvances?: Array<{ id: number; opsUserId: number; amount: number; reason: string; date: string; name: string | null; status: 'RECORDED' | 'DRAFT' | 'VOIDED' | 'PENDING'; version: number }>;
  suppliers: Array<{ id: number; name: string }>;
  /** Card 20261005 — nhà xe (NCC gánh loại CARRIER) kèm tuyến chạy gần nhất;
   *  ô "Nhà cung cấp" tự chọn nhà xe theo tuyến của dòng đang khai. */
  carriers: Array<{ id: number; name: string; routeName: string | null }>;
  expenseTypes: Array<{ code: string; name: string }>;
}
export interface ExpenseReportFilters extends ExpenseListQuery { direction: 'IN' | 'OUT'; asOfDate?: string }
export interface ExpenseReportRow {
  entityType: string; entityId: number; entityName: string; carrierCode: string | null;
  lift: number; drop: number; other: number; total: number; settled: number | null; outstanding: number | null;
  entries: ExpenseAccountingEntry[];
}
export interface ExpenseReport {
  direction: 'IN' | 'OUT'; dateBasis: 'expenseDate'; from: string | null; to: string | null; asOfDate: string;
  items: ExpenseReportRow[]; unknownCount: number; totals: Pick<ExpenseReportRow, 'lift' | 'drop' | 'other' | 'total' | 'settled' | 'outstanding'>;
}
const BASE = '/expense-accounting';
function query(values: object) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  return params.toString();
}

export const expenseAccountingClient = {
  uploadProof: (entry: ExpenseSourceRef, file: File) => {
    const form = new FormData(); form.append('file', file);
    return api.upload(`${BASE}/entries/${entry.sourceKind}/${entry.sourceId}/photos/upload`, form,
      { retryFingerprint: `accounting-proof:${entry.sourceKind}:${entry.sourceId}:${fileCommandFingerprint(file)}` }) as Promise<{ storageKey: string; url: string }>;
  },
  get: (entry: Pick<ExpenseSourceRef, 'sourceKind' | 'sourceId'>) => api.get<ExpenseAccountingEntry>(`${BASE}/entries/${entry.sourceKind}/${entry.sourceId}`),
  refundReconciliation: (id: number, body: { treasuryAccountId: number; valueDate: string; physicalReference: string; amount: number; reason: string }, key: string) => api.post<ExpenseVoucher>(`${BASE}/reconciliations/${id}/refund`, body, { headers: { 'Idempotency-Key': key } }),
  fundAdvance: (body: { opsUserId: number; amount: number; reason: string; treasuryAccountId: number; valueDate: string; physicalReference: string; advanceRequestId?: number }, key: string) => api.post(`${BASE}/advances`, body, { headers: { 'Idempotency-Key': key } }),
  work: (params: ExpenseListQuery) => api.get<ExpenseWorkList>(`${BASE}/work?${query(params)}`),
  catalog: () => api.get<ExpenseAccountingCatalog>(`${BASE}/catalog`),
  create: (body: ExpenseAccountingCreate, key: string) => api.post<ExpenseAccountingEntry>(`${BASE}/entries`, body, { headers: { 'Idempotency-Key': key } }),
  /** Card 20261005 — lưu nhiều khoản chi một lần: một mã thao tác cho cả đợt. */
  createBatch: (body: ExpenseAccountingCreateBatch, key: string) => api.post<{ items: ExpenseAccountingEntry[] }>(`${BASE}/entries/batch`, body, { headers: { 'Idempotency-Key': key } }),
  assignments: () => api.get<{ items: TruckAccountantAssignment[] }>(`${BASE}/assignments`),
  assign: (body: { truckId: number; accountantId: number | null; expectedVersion: number }) => api.post<TruckAccountantAssignment>(`${BASE}/assignments`, body),
  report: (params: ExpenseReportFilters) => api.get<ExpenseReport>(`${BASE}/reports?${query(params)}`),
  exportReport: (params: ExpenseReportFilters) => api.getBlob(`${BASE}/reports/export?${query(params)}`),
  allocateVoucher: (id: number, expectedVersion: number, key: string) => api.post<ExpenseVoucher>(`${BASE}/vouchers/${id}/allocate`, { expectedVersion }, { headers: { 'Idempotency-Key': key } }),
  reverseVoucher: (id: number, body: { expectedVersion: number; reason: string; valueDate: string; physicalReference: string }, key: string) => api.post<ExpenseVoucher>(`${BASE}/vouchers/${id}/reverse`, body, { headers: { 'Idempotency-Key': key } }),
  list: (params: ExpenseListQuery) => api.get<ExpenseAccountingList>(`${BASE}/entries?${query(params)}`),
  update: (entry: ExpenseSourceRef, body: ExpenseAccountingUpdate) => api.post<ExpenseAccountingEntry>(`${BASE}/entries/${entry.sourceKind}/${entry.sourceId}/update`, body),
  correct: (entry: ExpenseSourceRef, body: ExpenseAccountingUpdate) => api.post<ExpenseAccountingEntry>(`${BASE}/entries/${entry.sourceKind}/${entry.sourceId}/correct`, body),
  confirm: (entries: ExpenseSourceRef[]) => api.post<{ items: ExpenseAccountingEntry[] }>(`${BASE}/confirm`, { entries }),
  vouchers: () => api.get<{ items: ExpenseVoucher[] }>(`${BASE}/vouchers`),
  createVoucher: (body: ExpenseVoucherInput, key: string) => api.post<ExpenseVoucher>(`${BASE}/vouchers`, body, { headers: { 'Idempotency-Key': key } }),
  reconciliations: () => api.get<{ items: ExpenseReconciliation[] }>(`${BASE}/reconciliations`),
  releaseReconciliation: (id: number, reason: string, key: string) => api.post(`${BASE}/reconciliations/${id}/release`, { reason }, { headers: { 'Idempotency-Key': key } }),
  // Card 20261005 — ô chốt "đã hoàn ứng xong": ghi/nhả trạng thái chốt của đợt.
  // expectedVersion là token trạng thái chốt (1 = chưa chốt, 2 = đã chốt).
  settleRefund: (id: number, body: { expectedVersion: number; settled: boolean }) => api.post<ExpenseReconciliation>(`${BASE}/reconciliations/${id}/settle-refund`, body),
  reconcile: (body: ExpenseReconciliationInput, key: string) => api.post<ExpenseReconciliation>(`${BASE}/reconciliations`, body, { headers: { 'Idempotency-Key': key } }),
};
