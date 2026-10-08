/**
/**
 * API client for the Ops field-operations portal (docs/prd/OpsVanHanh.docx),
 * backed by backend/src/routes/ops.ts.
 */
import { api, fileCommandFingerprint } from '../lib/api';
import type { ExpenseCostGroup } from '@tingting/shared';

export interface OpsOrderItem {
  id: number;
  shipmentCode: string | null;
  status: string | null;
  tradeDirection: string | null;
  billRef: string | null;
  customerName: string | null;
  routeName: string | null;
  pinned: boolean;
  pinnedAt: string | null;
  containerCount: number;
  containerNumbers: string[];
  containerIds: number[];
}

export interface OpsWalletSummary {
  totalAdvance: string;
  approved: string;
  pending: string;
  rejected: string;
  /**
/** Σ refundAmount các đề nghị thanh toán tạm ứng ĐÃ DUYỆT */
  returned: string;
  /**
/** totalAdvance − (approved + pending) − returned; có thể âm */
  balance: string;
}

export interface OpsFundBookEntry {
  key: string;
  date: string;
  kind: 'ADVANCE' | 'EXPENSE' | 'REFUND' | 'REFUND_REVERSAL' | 'REIMBURSEMENT';
  label: string;
  /** Mã chứng từ hiển thị (phiếu quyết toán / phiếu thu chi) hoặc null. */
  reference: string | null;
  /** Số tiền có dấu góc nhìn quỹ nhân viên: + nhận, − chi/hoàn. */
  amount: string;
}

export interface OpsFundBookPeriod {
  from?: string;
  to?: string;
}

export interface OpsFundBook {
  items: OpsFundBookEntry[];
  /** Σ toàn thời gian — luôn là con số này, không đổi theo khoảng lọc. */
  closing: string;
  walletBalance: string;
  /** "Còn phải hoàn ứng" của kế toán, cũng toàn thời gian. */
  outstandingAdvanceBalance: string;
  matches: boolean;
  /**
   * Card 20260928_168 (ruling PM 2026-09-29 câu 2): các con số theo khoảng
   * ngày đang chọn. `periodOpening` là số dư lũy kế TRƯỚC `from` (0 khi không
   * lọc) và `periodClosing` = periodOpening + net trong kỳ, tức số dư cuối
   * `to`; do đó periodOpening + (net trong kỳ) luôn bằng periodClosing — lát
   * cắt không bao giờ lệch với sổ mà nó cắt ra. from/to null = không lọc, và
   * khi đó `periodClosing` trùng đúng `closing` toàn thời gian.
   */
  period: { from: string | null; to: string | null };
  periodOpening: string;
  periodIn: string;
  periodOut: string;
  periodClosing: string;
}

export type OpsExpenseStatus = 'DRAFT' | 'RECORDED' | 'VOIDED' | 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * Card 20261008_2 — full-set per-status counts for the "Lịch sử chi phí"
 * status filter tabs (the envelope's `statusCounts`, never page-derived).
 * Each bucket sizes exactly the rows that tab reveals across BOTH sources the
 * list merges (native Ops rows + legacy trip-sourced rows), so the numeral
 * always agrees with the list behind it. Buckets the legacy loader's
 * asymmetry keeps out of a view (DRAFT/VOIDED/PENDING/REJECTED never see the
 * legacy rows) stay honest by construction; every key is always present and
 * an empty bucket is `0`, never absent.
 */
export interface OpsExpenseStatusCounts {
  all: number;
  DRAFT: number;
  RECORDED: number;
  VOIDED: number;
  PENDING: number;
  APPROVED: number;
  REJECTED: number;
}

export interface OpsExpenseRow {
  sourceKind?: 'OPS' | 'TRIP';
  sourceId?: number;
  /** Trip of a legacy (TRIP-sourced) row — the Sửa/Xóa route into the chi-hô
   *  entry APIs (card 071026141580). */
  tripId?: number | null;
  id: number;
  shipmentId: number;
  shipmentCode: string | null;
  billRef: string | null;
  containerNumber: string | null;
  expenseTypeCode: string;
  expenseTypeName: string | null;
  requiresInvoice: boolean | null;
  amount: string;
  paidAt: string;
  note: string | null;
  approvalStatus: OpsExpenseStatus;
  rejectionReason: string | null;
  opsSettlementId: number | null;
  hasPhoto: boolean;
  paidById: number;
  paidByName: string | null;
  createdAt: string;
  version?: number;
  confirmedAt?: string | null;
  costGroup?: ExpenseCostGroup | null;
  feeName?: string | null;
  customerChargeAmount?: number | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  recoveryNote?: string | null;
}

export interface OpsExpensePhoto {
  id: number;
  storageKey: string;
  url: string;
  uploadedAt: string;
}

export interface OpsFleetTruck {
  truckId: number;
  licensePlate: string;
  trailerPlate: string | null;
  tripId: number | null;
  tripCode: string | null;
  shipmentCode: string | null;
  billRef: string | null;
  driverName: string | null;
  status: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | null;
  lastEventType: string | null;
  updatedAt: string | null;
}

export interface OpsSettlementListItem {
  id: number;
  code: string;
  status: 'DRAFT' | 'RECORDED' | 'VOIDED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  totalAmount: string;
  note: string | null;
  createdAt: string;
  approvedAt: string | null;
  opsUserId: number;
  opsUserName: string | null;
}

export interface OpsSettlementGroupItem {
  id?: number;
  shipmentId: number;
  shipmentCode: string | null;
  customerName: string | null;
  billRef: string | null;
  containerNumber: string | null;
  expenseTypeName: string | null;
  requiresInvoice: boolean | null;
  amount: string;
  approvalStatus: string;
}

export interface OpsSettlementDetail {
  settlement: Omit<OpsSettlementListItem, 'opsUserId' | 'opsUserName'> & {
    opsUserId: number;
    opsUserName: string | null;
  };
  grouping: {
    groups: Array<{
      shipmentId: number;
      shipmentCode: string | null;
      customerName: string | null;
      billRef: string | null;
      withInvoice: { items: OpsSettlementGroupItem[]; total: string };
      withoutInvoice: { items: OpsSettlementGroupItem[]; total: string };
      total: string;
    }>;
    totals: { withInvoice: string; withoutInvoice: string; grand: string };
  };
}

export interface OpsExpenseTypeOption {
  id: number;
  code: string;
  name: string;
  requiresInvoice: boolean | null;
  /** Card 20260928_161 — the catalog's settlement category (LIFT / DROP /
   *  HQGS / CSHT / KHAC / PHAT_SINH, null = chưa phân loại). Always sent by
   *  `/ops/expense-types`; the Ops form derives its Nâng / Hạ / Phí khác group
   *  from it. Optional only so hand-written fixtures stay valid. */
  category?: string | null;
}

export interface OpsAdvanceRequestRow {
  id: number;
  version: number;
  requesterId: number;
  amount: string;
  /** Posted funding, net of reversals. Absent means UNKNOWN, never "unfunded". */
  fundedAmount?: number;
  reason: string;
  status: string;
  createdAt: string;
  approverName?: string | null;
  approvedAt?: string | null;
}

export interface OpsAdvanceRequestEnvelope {
  items: OpsAdvanceRequestRow[];
  total: number;
  page: number;
  limit: number;
  /**
   * Full-set counts per status (requester-scoped, status filter excluded) —
   * KPIs must never derive from the current page (ForwarderAdvancesPage rule).
   * Optional only so hand-written fixtures stay valid; the server always sends
   * it.
   */
  statusCounts?: Record<string, number>;
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export const opsClient = {
  // ── Kế hoạch làm hàng ──
  getOrders: (date: string, q?: string) =>
    api.get<{ date: string; items: OpsOrderItem[] }>(`/ops/orders${qs({ date, q })}`),
  /**
/** PUT set-semantics: a replayed request converges instead of toggling. */
  setPin: (shipmentId: number, pinned: boolean) =>
    api.put<{ pinned: boolean }>(`/ops/orders/shipment-pins/${shipmentId}`, { pinned }),

  // ── Ví ──
  getWalletSummary: () => api.get<OpsWalletSummary>('/ops/wallet/summary'),
  // Card 20260928_168 — the sổ quỹ reads over a period (ruling PM câu 2). The
  // window is part of the REQUEST, not a client-side filter, so the rows and
  // the summary figures always come from one read of one window.
  getFundBook: (period?: OpsFundBookPeriod) =>
    api.get<OpsFundBook>(`/ops/wallet/fund-book${qs({ from: period?.from, to: period?.to })}`),
  getWalletExpenses: (status?: OpsExpenseStatus) =>
    api.get<{ items: OpsExpenseRow[]; statusCounts: OpsExpenseStatusCounts }>(`/ops/wallet/expenses${qs({ status })}`),
  createAdvanceRequest: (body: { amount: number; reason: string }) =>
    api.post<unknown>('/ops/wallet/advance-requests', body),
  getWalletAdvanceRequests: (params?: { status?: string; page?: number; limit?: number }) =>
    api.get<OpsAdvanceRequestEnvelope>(
      `/ops/wallet/advance-requests${qs({ status: params?.status, page: params?.page, limit: params?.limit })}`,
    ),

  // ── Khoản chi ──
  getExpenseTypes: () =>
    api.get<{ items: OpsExpenseTypeOption[] }>('/ops/expense-types'),
  // Card 071026210510: the dialog asks the grant BEFORE the operator types —
  // the same predicate the save enforces, answered as a verdict, not a 403.
  getExpenseWriteScope: (shipmentId: number) =>
    api.get<{ writable: boolean; reason: string | null }>(`/ops/expenses/write-scope${qs({ shipmentId })}`),
  createExpense: (body: {
    shipmentId: number;
    shipmentContainerId?: number | null;
    expenseTypeCode: string;
    amount: string | number;
    paidAt: string;
    note?: string | null;
    photoStorageKeys?: string[];
    costGroup?: ExpenseCostGroup;
    feeName?: string;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    recoveryNote?: string | null;
  }) => api.post<OpsExpenseRow & { id: number }>('/ops/expenses', body),
  updateExpense: (id: number, body: Record<string, unknown>) =>
    api.patch<OpsExpenseRow>(`/ops/expenses/${id}`, body),
  deleteExpense: (id: number, reason: string) => api.delete<{ success: boolean }>(`/ops/expenses/${id}`, { body: JSON.stringify({ reason }) }),
  uploadExpensePhoto: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const fingerprint = ['ops-expense-photo', fileCommandFingerprint(file)].join(':');
    return api.upload('/ops/expense-photos/upload', formData, {
      retryFingerprint: fingerprint,
    }) as Promise<{ storageKey: string; url: string }>;
  },
  attachExpensePhoto: (expenseId: number, storageKey: string) =>
    api.post<OpsExpensePhoto | null>(`/ops/expenses/${expenseId}/photos`, { storageKey }),
  deleteExpensePhoto: (photoId: number) =>
    api.delete<{ success: boolean }>(`/ops/expense-photos/${photoId}`),
  getExpensePhotos: (expenseId: number) =>
    api.get<{ items: OpsExpensePhoto[] }>(`/ops/expenses/${expenseId}/photos`),

  // ── Đối soát khoản chi ──
  getSettlements: (status?: string) =>
    api.get<{ items: OpsSettlementListItem[] }>(`/ops/settlements${qs({ status })}`),
  createSettlement: (note?: string) =>
    api.post<OpsSettlementListItem>('/ops/settlements', note ? { note } : {}),
  getSettlement: (id: number) =>
    api.get<OpsSettlementDetail>(`/ops/settlements/${id}`),
  /** Blob download via the authed api client — plain <a href> would 401
   *  because authMiddleware reads only the Authorization header. */
  downloadSettlementExport: async (id: number, code: string, admin = false) => {
    const blob = await api.getBlob(`/ops/${admin ? 'admin/' : ''}settlements/${id}/export`);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${code}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },

  // ── Fleet ──
  getFleet: () => api.get<{ items: OpsFleetTruck[] }>('/ops/fleet'),
  getTruckOpsAssignments: () =>
    api.get<{ items: Array<{ truckId: number; opsUserId: number; opsUserName: string | null }> }>(
      '/ops/trucks/ops-assignments'),
  setTruckOpsAssignment: (truckId: number, opsUserId: number | null) =>
    api.put<{ opsUserId: number | null }>(`/ops/trucks/${truckId}/ops-assignment`, { opsUserId }),

  // ── Sổ khoản chi (kế toán/quản lý) ──
  getAdminExpenses: (filters: { status?: OpsExpenseStatus; opsUserId?: number } = {}) =>
    api.get<{ items: OpsExpenseRow[] }>(`/ops/admin/expenses${qs(filters)}`),
  getAdminSettlements: (status?: string) =>
    api.get<{ items: OpsSettlementListItem[] }>(`/ops/admin/settlements${qs({ status })}`),
  getAdminSettlement: (id: number) =>
    api.get<OpsSettlementDetail>(`/ops/admin/settlements/${id}`),
  reopenSettlementDraft: (id: number) => api.post<OpsSettlementListItem>(`/ops/settlements/${id}/reopen-draft`, {}),
  finalizeSettlement: (id: number) => api.post<OpsSettlementListItem>(`/ops/settlements/${id}/finalize`, {}),
};
