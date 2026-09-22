// Deposit-refund tracker API client — card 20260921_19 (THEO DÕI HOÀN CƯỢC
// CONTAINER). Thin helpers over the shared `api` wrapper for
// /accounting/deposits, mirroring the invoiceTrackingClient.ts idiom.

import { api } from '../lib/api';

export type DepositStatus = 'CHUA_HOAN_CUOC' | 'DA_HOAN_CUOC';

export interface DepositTrackerRow {
  id: number;
  shipmentId: number | null;
  billNumber: string;
  customerName: string;
  carrierName: string;
  depositAmount: string;
  cvSubmittedDate: string | null;
  expectedRefundDate: string | null;
  status: DepositStatus;
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

export async function listDepositTrackers(from?: string, to?: string, status?: DepositStatus): Promise<DepositTrackerListResponse> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (status) params.set('status', status);
  const qs = params.toString();
  return api.get<DepositTrackerListResponse>(`/accounting/deposits${qs ? `?${qs}` : ''}`);
}

export async function createDepositTracker(body: {
  billNumber: string; customerName: string; carrierName: string; depositAmount: number | string;
  cvSubmittedDate?: string | null; expectedRefundDate?: string | null; note?: string | null;
}): Promise<DepositTrackerRow> {
  return api.post<DepositTrackerRow>('/accounting/deposits', body);
}

export async function updateDepositTrackerDates(id: number, body: {
  cvSubmittedDate?: string | null; expectedRefundDate?: string | null; note?: string | null; depositAmount?: number | string;
}): Promise<DepositTrackerRow> {
  return api.patch<DepositTrackerRow>(`/accounting/deposits/${id}/dates`, body);
}

export async function markDepositRefunded(id: number, expectedDepositAmount?: number): Promise<DepositTrackerRow> {
  return api.post<DepositTrackerRow>(`/accounting/deposits/${id}/refund`,
    expectedDepositAmount === undefined ? {} : { expectedDepositAmount });
}
