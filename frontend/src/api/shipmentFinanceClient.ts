import type { ContainerDepositInput, ShipmentFinanceRecords, ShipmentInvoiceRecordInput } from '@tingting/shared';
import { api } from '../lib/api';

export interface ShipmentFinanceFilters {
  shipmentId?: number;
  search?: string;
  from?: string;
  to?: string;
  depositState?: 'OPEN' | 'REFUNDED';
  page?: number;
}

export const shipmentFinanceClient = {
  list(filters: ShipmentFinanceFilters) {
    const { shipmentId, ...query } = filters;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) search.set(key, String(value));
    return api.get<ShipmentFinanceRecords>(`/shipments/${shipmentId ? `${shipmentId}/` : ''}finance-records?${search}`);
  },
  options: (shipmentId?: number) => api.get<{
    trips: Array<{ id: number; tripCode: string | null }>;
    suppliers: Array<{ id: number; name: string }>;
    expenses: Array<{ id: number; supplierId: number | null; buyAmount: string; expenseType: string; invoiceNumber: string | null }>;
  }>(`/shipments/finance-record-options${shipmentId ? `?shipmentId=${shipmentId}` : ''}`),
  saveInvoice: (shipmentId: number, payload: ShipmentInvoiceRecordInput, key: string) =>
    api.post(`/shipments/${shipmentId}/invoice-records`, payload, { headers: { 'Idempotency-Key': key } }),
  saveDeposit: (shipmentId: number, payload: ContainerDepositInput, key: string) =>
    api.post(`/shipments/${shipmentId}/container-deposits`, payload, { headers: { 'Idempotency-Key': key } }),
};
