import { api } from '../lib/api';
import type { ProfitabilityDimension, ProfitabilityReport } from '@tingting/shared';
import type {
  AccountingTransportOwnership,
  AccountingTransportReadiness,
  AccountingTransportRegisterResponse,
} from '@tingting/shared';

export type RecoverableEligibilityState = 'READY_FOR_REVIEW' | 'ELIGIBLE' | 'BLOCKED' | 'ALREADY_CLAIMED' | 'ADJUSTMENT_REQUIRED';

export interface RecoverableCost {
  id: number;
  version: number;
  tripId: number;
  tripCode: string | null;
  shipmentId: number | null;
  shipmentCode: string | null;
  customerId: number;
  customerName: string;
  expenseType: string;
  expenseTypeName: string | null;
  expenseDate: string | null;
  buyAmount: number;
  sellAmount: number;
  recoverablePrincipalAmount: number | null;
  serviceFeeAmount: number | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  invoiceNumber: string | null;
  invoiceDate: string | null;
  noInvoiceEvidenceTypes: string[];
  eligibility: { state: RecoverableEligibilityState; blockedReason: string | null };
  claim: { documentId: number; documentStatus: string | null; sourceVersion: string | null } | null;
  updatedAt: string;
}

export interface TreasuryPosition {
  asOf: string;
  currency: 'VND';
  coverage: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  accounts: Array<{
    accountId: number;
    code: string;
    name: string;
    type: 'CASH' | 'BANK';
    currency: string;
    openingBalance: number;
    totalIn: number;
    totalOut: number;
    bookBalance: number;
    completeness: 'COMPLETE' | 'PARTIAL';
    cutoverAt: string | null;
  }>;
}

export type { ProfitabilityDimension, ProfitabilityReport } from '@tingting/shared';

export interface CustomerVisibleEvent {
  id: number;
  shipmentId: number;
  version: number;
  eventType: 'MILESTONE' | 'DELIVERY_PLAN' | 'DOCUMENT_UPDATE' | 'DEBIT_NOTE_CONFIRMATION';
  title: string;
  message: string;
  occurredAt: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export const customerServiceFinanceClient = {
  getAccountingTransportRegister(params: {
    from: string;
    to: string;
    page: number;
    limit: number;
    search?: string;
    customerId?: number;
    carrierId?: number;
    ownership?: AccountingTransportOwnership;
    readiness?: AccountingTransportReadiness;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  }) {
    const query = new URLSearchParams({
      from: params.from,
      to: params.to,
      page: String(params.page),
      limit: String(params.limit),
    });
    if (params.search?.trim()) query.set('search', params.search.trim());
    if (params.customerId) query.set('customerId', String(params.customerId));
    if (params.carrierId) query.set('carrierId', String(params.carrierId));
    if (params.ownership) query.set('ownership', params.ownership);
    if (params.readiness) query.set('readiness', params.readiness);
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortDir) query.set('sortDir', params.sortDir);
    return api.get<AccountingTransportRegisterResponse>(
      `/finance/billing-documents/transport-register?${query}`,
    );
  },
  listRecoverableCosts(params: { page: number; limit: number; approvalStatus?: string; sortBy?: string; sortDir?: 'asc' | 'desc' }) {
    const query = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
    if (params.approvalStatus) query.set('approvalStatus', params.approvalStatus);
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortDir) query.set('sortDir', params.sortDir);
    return api.get<{ items: RecoverableCost[]; total: number; page: number; limit: number }>(`/recoverable-costs?${query}`);
  },
  requestRecoverableCost(id: number, body: {
    decision: 'APPROVED' | 'REJECTED'; reason: string; expectedVersion: number;
    evidence: { reviewNote: string; attachmentRefs: string[] };
  }, idempotencyKey: string) {
    return api.post(`/recoverable-costs/${id}/request`, body, { headers: { 'Idempotency-Key': idempotencyKey } });
  },
  getTreasuryPosition: (params?: { sortBy?: string; sortDir?: 'asc' | 'desc' }) => {
    const query = new URLSearchParams();
    if (params?.sortBy) query.set('sortBy', params.sortBy);
    if (params?.sortDir) query.set('sortDir', params.sortDir);
    const qs = query.toString();
    return api.get<TreasuryPosition>(`/finance/treasury/position${qs ? `?${qs}` : ''}`);
  },
  getProfitability(params: { month: number; year: number; dimension: ProfitabilityDimension; page?: number; lowMarginOnly?: boolean }) {
    const query = new URLSearchParams({
      month: String(params.month), year: String(params.year), dimension: params.dimension,
      page: String(params.page ?? 1), limit: '50',
    });
    if (params.lowMarginOnly) query.set('alert', 'LOW_MARGIN');
    return api.get<ProfitabilityReport>(`/reports/profitability?${query}`);
  },
  exportProfitability(params: { month: number; year: number; dimension: ProfitabilityDimension; lowMarginOnly?: boolean }) {
    const query = new URLSearchParams({
      month: String(params.month), year: String(params.year), dimension: params.dimension,
    });
    if (params.lowMarginOnly) query.set('alert', 'LOW_MARGIN');
    return api.getBlob(`/reports/profitability/export?${query}`);
  },
  listShipmentEvents: (shipmentId: number) => api.get<{ items: CustomerVisibleEvent[] }>(`/shipments/${shipmentId}/customer-events`),
  createShipmentEvent: (
    shipmentId: number,
    body: Omit<CustomerVisibleEvent, 'id' | 'shipmentId' | 'version' | 'acknowledged' | 'acknowledgedAt'> & { eventKey: string },
  ) => (
    api.post<CustomerVisibleEvent>(`/shipments/${shipmentId}/customer-events`, body)
  ),
  listPortalShipmentEvents: (shipmentId: number, customerId: number | null) => api.get<{ items: CustomerVisibleEvent[] }>(
    `/portal/shipments/${shipmentId}/customer-events${customerId == null ? '' : `?customerId=${customerId}`}`,
  ),
  acknowledgePortalEvent: (shipmentId: number, event: CustomerVisibleEvent, customerId: number | null) => api.post(
    `/portal/shipments/${shipmentId}/customer-events/${event.id}/acknowledge${customerId == null ? '' : `?customerId=${customerId}`}`,
    { expectedVersion: event.version, kind: 'ACKNOWLEDGED' },
    { headers: { 'Idempotency-Key': crypto.randomUUID() } },
  ),
};
