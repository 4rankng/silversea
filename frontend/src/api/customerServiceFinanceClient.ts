import { api } from '../lib/api';

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

export type ProfitabilityDimension = 'CUSTOMER' | 'ROUTE' | 'TRUCK' | 'DISPATCHER' | 'SALESPERSON' | 'MONTH' | 'YEAR' | 'CONTAINER';

export interface ProfitabilityReport {
  requestedPeriod: { month: number; year: number };
  asOf: string;
  definitionVersion: string;
  dimension: ProfitabilityDimension;
  page: number;
  limit: number;
  totalGroups: number;
  totalPages: number;
  items: Array<{
    key: string;
    label: string | null;
    attributionStatus: 'ATTRIBUTED' | 'MISSING';
    revenue: string;
    directCost: string;
    sharedOverhead: string;
    profit: string;
    tripCount: number;
  }>;
  totals: { revenue: number; directCost: number; sharedOverhead: number; profit: number };
  sourceCoverage: { snapshottedTrips: number; pnlTrips: number; missingAttribution: number };
  reconciliation: { difference: number; status: 'RECONCILED' | 'PARTIAL'; note: string };
}

export interface CustomerVisibleEvent {
  id: number;
  shipmentId: number;
  version: number;
  eventType: 'MILESTONE' | 'DELIVERY_PLAN' | 'DOCUMENT_UPDATE' | 'DEBIT_NOTE_CONFIRMATION';
  title: string;
  message: string;
  occurredAt: string;
  shipmentCode?: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export const customerServiceFinanceClient = {
  listRecoverableCosts(params: { page: number; limit: number; approvalStatus?: string }) {
    const query = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
    if (params.approvalStatus) query.set('approvalStatus', params.approvalStatus);
    return api.get<{ items: RecoverableCost[]; total: number; page: number; limit: number }>(`/recoverable-costs?${query}`);
  },
  requestRecoverableCost(id: number, body: {
    decision: 'APPROVED' | 'REJECTED'; reason: string; expectedVersion: number;
    evidence: { reviewNote: string; attachmentRefs: string[] };
  }, idempotencyKey: string) {
    return api.post(`/recoverable-costs/${id}/request`, body, { headers: { 'Idempotency-Key': idempotencyKey } });
  },
  getTreasuryPosition: () => api.get<TreasuryPosition>('/finance/treasury/position'),
  getProfitability(params: { month: number; year: number; dimension: ProfitabilityDimension; page?: number }) {
    const query = new URLSearchParams({
      month: String(params.month), year: String(params.year), dimension: params.dimension,
      page: String(params.page ?? 1), limit: '50',
    });
    return api.get<ProfitabilityReport>(`/reports/profitability?${query}`);
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
