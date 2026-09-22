// Invoice-tracking API client — card 20260921_18 (THEO DÕI HÓA ĐƠN KẾT HỢP).
//
// Thin helpers over the shared `api` wrapper for /accounting/invoice-tracking,
// mirroring the shipmentClient.ts idiom. Writes carry an Idempotency-Key
// header — the backend routes require it (runIdempotent, per-endpoint keys).

import { api } from '../lib/api';
import {
  type InvoiceTrackingCreateInput,
  type InvoiceTrackingPatchInput,
  type InvoiceTrackingRow,
} from '@tingting/shared';

export interface InvoiceTrackingTotals {
  invoice: number;
  paid: number;
  difference: number;
}

export interface InvoiceTrackingListResponse {
  rows: InvoiceTrackingRow[];
  totals: InvoiceTrackingTotals;
}

export async function listInvoiceTracking(from: string, to: string): Promise<InvoiceTrackingListResponse> {
  return api.get<InvoiceTrackingListResponse>(`/accounting/invoice-tracking?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

export async function createInvoiceTracking(body: InvoiceTrackingCreateInput, idempotencyKey: string = crypto.randomUUID()): Promise<InvoiceTrackingRow> {
  return api.post<InvoiceTrackingRow>('/accounting/invoice-tracking', body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export async function updateInvoiceTracking(id: number, body: InvoiceTrackingPatchInput, idempotencyKey: string = crypto.randomUUID()): Promise<InvoiceTrackingRow> {
  return api.patch<InvoiceTrackingRow>(`/accounting/invoice-tracking/${id}`, body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export async function deleteInvoiceTracking(id: number): Promise<void> {
  await api.delete(`/accounting/invoice-tracking/${id}`, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
}
