/**
 * API client for the Ops field-operations portal (docs/prd/OpsVanHanh.md),
 * backed by backend/src/routes/ops.ts.
 */
import { api, fileCommandFingerprint } from '../lib/api';

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
  balance: string;
}

export type OpsExpenseStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface OpsExpenseRow {
  id: number;
  shipmentId: number;
  shipmentCode: string | null;
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
  driverName: string | null;
  status: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | null;
  lastEventType: string | null;
  updatedAt: string | null;
}

export interface OpsSettlementListItem {
  id: number;
  code: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
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
  togglePin: (shipmentId: number) =>
    api.post<{ pinned: boolean }>(`/ops/orders/shipment-pins/${shipmentId}/toggle`, {}),

  // ── Ví ──
  getWalletSummary: () => api.get<OpsWalletSummary>('/ops/wallet/summary'),
  getWalletExpenses: (status?: OpsExpenseStatus) =>
    api.get<{ items: OpsExpenseRow[] }>(`/ops/wallet/expenses${qs({ status })}`),
  createAdvanceRequest: (body: { amount: number; reason: string }) =>
    api.post<unknown>('/ops/wallet/advance-requests', body),

  // ── Khoản chi ──
  getExpenseTypes: () =>
    api.get<{ items: OpsExpenseTypeOption[] }>('/ops/expense-types'),
  createExpense: (body: {
    shipmentId: number;
    shipmentContainerId?: number | null;
    expenseTypeCode: string;
    amount: string | number;
    paidAt: string;
    note?: string | null;
    photoStorageKeys?: string[];
  }) => api.post<OpsExpenseRow & { id: number }>('/ops/expenses', body),
  updateExpense: (id: number, body: Record<string, unknown>) =>
    api.patch<OpsExpenseRow>(`/ops/expenses/${id}`, body),
  deleteExpense: (id: number) => api.delete<{ success: boolean }>(`/ops/expenses/${id}`),
  resendExpense: (id: number) =>
    api.post<OpsExpenseRow>(`/ops/expenses/${id}/resend`, {}),
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

  // ── Đề nghị thanh toán ──
  getSettlements: (status?: string) =>
    api.get<{ items: OpsSettlementListItem[] }>(`/ops/settlements${qs({ status })}`),
  createSettlement: (note?: string) =>
    api.post<OpsSettlementListItem>('/ops/settlements', note ? { note } : {}),
  getSettlement: (id: number) =>
    api.get<OpsSettlementDetail>(`/ops/settlements/${id}`),

  // ── Fleet ──
  getFleet: () => api.get<{ items: OpsFleetTruck[] }>('/ops/fleet'),

  // ── Duyệt (kế toán/quản lý) ──
  getAdminExpenses: (filters: { status?: OpsExpenseStatus; opsUserId?: number } = {}) =>
    api.get<{ items: OpsExpenseRow[] }>(`/ops/admin/expenses${qs(filters)}`),
  approveExpense: (id: number) =>
    api.post<OpsExpenseRow>(`/ops/admin/expenses/${id}/approve`, {}),
  rejectExpense: (id: number, reason: string) =>
    api.post<OpsExpenseRow>(`/ops/admin/expenses/${id}/reject`, { reason }),
  getAdminSettlements: (status?: string) =>
    api.get<{ items: OpsSettlementListItem[] }>(`/ops/admin/settlements${qs({ status })}`),
  getAdminSettlement: (id: number) =>
    api.get<OpsSettlementDetail>(`/ops/admin/settlements/${id}`),
  approveSettlement: (id: number) =>
    api.post<OpsSettlementListItem>(`/ops/admin/settlements/${id}/approve`, {}),
  rejectSettlement: (id: number, reason: string) =>
    api.post<OpsSettlementListItem>(`/ops/admin/settlements/${id}/reject`, { reason }),
};
