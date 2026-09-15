import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { FORWARDER, FINANCIAL } from '@tingting/shared';
import type {
  ForwarderTripDetail,
  ForwarderTripSummary,
  AdvanceRequestWithRefs,
  AdvanceSettlementWithRefs,
  TripExpenseWithSupplier,
} from '@tingting/shared';

export const forwarderClient = {
  getTrips: async (
    status?: string,
    filters?: { search?: string; dateFrom?: string; dateTo?: string },
  ) => {
    return api.get<{
      items: ForwarderTripSummary[];
      counts: Record<string, number>;
    }>(`${FORWARDER.TRIPS}${toQuery({ status, search: filters?.search, dateFrom: filters?.dateFrom, dateTo: filters?.dateTo })}`);
  },

  getTripDetail: async (id: number) => {
    return api.get<ForwarderTripDetail>(FORWARDER.TRIP_DETAIL(id));
  },

  collectPaperOrder: async (tripId: number, expectedVersion: number, idempotencyKey?: string) => {
    return api.post(`/forwarder/me/trips/${tripId}/paper-order-collection`, { expectedVersion }, { idempotencyKey });
  },

  startOrderExchange: async (shipmentId: number, expectedVersion: number, idempotencyKey?: string) => {
    return api.post(FORWARDER.ORDER_EXCHANGE_START(shipmentId), { expectedVersion }, { idempotencyKey });
  },

  completeOrderExchange: async (shipmentId: number, expectedVersion: number, idempotencyKey?: string) => {
    return api.post(FORWARDER.ORDER_EXCHANGE_COMPLETE(shipmentId), { expectedVersion }, { idempotencyKey });
  },

  listSuppliers: async () => {
    return api.get<{ items: Array<{ id: number; name: string; contactPerson: string | null; phone: string | null }> }>(FORWARDER.SUPPLIERS);
  },

  resolveLiftPrice: async (params: {
    portId: number;
    containerTypeId: number;
    direction: 'LIFT_UP' | 'LIFT_DOWN';
    loadState: 'LOADED' | 'EMPTY';
    date: string;
  }) => api.get<{
    suggestedPrice: number;
    liftPricingId: number | null;
    effectiveDate: string | null;
    source: 'MATRIX' | 'MANUAL';
  }>(`/forwarder/me/lift-pricing/resolve${toQuery(params)}`),

  createContainer: async (tripId: number, data: { containerTypeId?: number; containerNumber: string; sealNumber?: string; notes?: string }) => {
    return api.post(FORWARDER.CONTAINERS(tripId), data);
  },

  createExpense: async (data: {
    tripId: number;
    expenseType: string;
    buyAmount: number;
    sellAmount?: number;
    settlementMethod?: 'COMPANY_DIRECT' | 'OPS_ADVANCE';
    supplierId?: number;
    expenseDate?: string;
    payeeName?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    declarationNumber?: string;
    containerNumber?: string;
    /** B5: authoritative container FK (id). When set the server mirrors containerNumber. */
    tripContainerId?: number;
    portId?: number;
    containerTypeId?: number;
    loadState?: 'LOADED' | 'EMPTY';
    note?: string;
    noInvoiceEvidenceTypes?: string[];
  }) => {
    return api.post(FORWARDER.EXPENSES, data);
  },

  updateExpense: async (id: number, expectedUpdatedAt: string, data: {
    expenseType: string;
    buyAmount: number;
    sellAmount?: number;
    settlementMethod?: 'COMPANY_DIRECT' | 'OPS_ADVANCE';
    supplierId?: number | null;
    expenseDate?: string | null;
    payeeName?: string | null;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    declarationNumber?: string | null;
    tripContainerId?: number | null;
    portId?: number;
    containerTypeId?: number;
    loadState?: 'LOADED' | 'EMPTY';
    note?: string | null;
    noInvoiceEvidenceTypes?: string[] | null;
  }) => api.patch(`/forwarder/me/expenses/${id}`, data, { expectedUpdatedAt }),

  setExpenseCompletion: async (tripId: number, data: { tripContainerId: number | null; completed: boolean }) =>
    api.put(`/forwarder/me/trips/${tripId}/expense-completion`, data),

  deleteExpense: async (id: number, expectedUpdatedAt: string) => {
    return api.delete(FORWARDER.EXPENSE(id), { expectedUpdatedAt });
  },

  getAdvanceRequests: async (status?: string) => {
    return api.get<{ items: AdvanceRequestWithRefs[]; counts: Record<string, number> }>(`${FORWARDER.ADVANCE_REQUESTS}${toQuery({ status })}`);
  },
  getEligibleAdvanceRequests: async () => {
    return api.get<{ items: AdvanceRequestWithRefs[]; counts: Record<string, number> }>(
      `${FORWARDER.ADVANCE_REQUESTS}${toQuery({ status: 'RECORDED', eligibleForSettlement: true })}`,
    );
  },
  createAdvanceRequest: async (data: { amount: number; reason: string }) => {
    return api.post(FORWARDER.ADVANCE_REQUESTS, data);
  },

  getAdvanceBalance: async () => {
    return api.get<{ outstanding: string }>(FORWARDER.ADVANCE_BALANCE);
  },

  getAdvanceSettlements: async (params?: { status?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    qs.set('page', String(params?.page ?? 1));
    // No explicit limit → server default (500) keeps legacy full-list callers whole.
    if (params?.limit) qs.set('limit', String(params.limit));
    return api.get<{
      items: AdvanceSettlementWithRefs[];
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      statusCounts: Record<string, number>;
      totals: { totalExpenseAmount: number; pendingCount: number };
    }>(`${FORWARDER.ADVANCE_SETTLEMENTS}?${qs.toString()}`);
  },
  getAdvanceSettlementDetail: async (id: number) => {
    return api.get<AdvanceSettlementWithRefs>(FORWARDER.ADVANCE_SETTLEMENT_DETAIL(id));
  },
  createAdvanceSettlement: async (data: { totalExpenseAmount?: number; refundAmount?: number; note?: string; advanceRequestIds: number[]; tripExpenseIds?: number[] }) => {
    return api.post(FORWARDER.ADVANCE_SETTLEMENTS, data);
  },

  previewSettlementHtml: async (data: { totalExpenseAmount?: number; refundAmount?: number; note?: string; advanceRequestIds: number[]; tripExpenseIds?: number[] }) => {
    return api.postForText(`${FORWARDER.ADVANCE_SETTLEMENT_PREVIEW}?format=html`, data);
  },

  previewSettlementXlsx: async (data: { totalExpenseAmount?: number; refundAmount?: number; note?: string; advanceRequestIds: number[]; tripExpenseIds?: number[] }) => {
    return api.postForBlob(`${FORWARDER.ADVANCE_SETTLEMENT_PREVIEW}?format=xlsx`, data);
  },

  getUnlinkedExpenses: async () => {
    return api.get<{ items: TripExpenseWithSupplier[] }>(FORWARDER.UNLINKED_EXPENSES);
  },

  listAllAdvanceRequests: async (params?: {
    status?: string;
    page?: number;
    limit?: number;
    sortBy?: 'requesterName' | 'amount' | 'createdAt' | 'status' | 'reason';
    sortDir?: 'asc' | 'desc';
  }) => {
    return api.get<{
      items: AdvanceRequestWithRefs[];
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      statusCounts: Record<string, number>;
      statusAmounts: Record<string, number>;
    }>(`${FINANCIAL.ADVANCE_REQUESTS}${toQuery(params)}`);
  },
  listAllAdvanceSettlements: async (params?: { status?: string; page?: number; limit?: number }) => {
    return api.get<{
      items: AdvanceSettlementWithRefs[];
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      statusCounts: Record<string, number>;
      statusAmounts: Record<string, number>;
      totals: { totalExpenseAmount: number; pendingCount: number };
    }>(`${FINANCIAL.ADVANCE_SETTLEMENTS}${toQuery(params)}`);
  },
  getSettlementOpsCompletion: async (settlementIds: number[]) => {
    if (settlementIds.length === 0) return { items: [] as Array<{ settlementId: number; opsCompletion: NonNullable<AdvanceSettlementWithRefs['opsCompletion']> }> };
    const chunks: number[][] = [];
    for (let index = 0; index < settlementIds.length; index += 100) {
      chunks.push(settlementIds.slice(index, index + 100));
    }
    const responses = await Promise.all(chunks.map((chunk) =>
      api.get<{ items: Array<{ settlementId: number; opsCompletion: NonNullable<AdvanceSettlementWithRefs['opsCompletion']> }> }>(
        `${FORWARDER.FORWARDER_EXPENSES}/settlement-ops-completion${toQuery({ settlementIds: chunk.join(',') })}`,
      ),
    ));
    return { items: responses.flatMap((response) => response.items) };
  },
  updateAdvanceSettlement: async (id: number, data: {
    expectedVersion: number;
    advanceRequestIds: number[];
    tripExpenseIds: number[];
    refundAmount: number;
    note?: string | null;
  }) => api.put<AdvanceSettlementWithRefs>(`${FINANCIAL.ADVANCE_SETTLEMENTS}/${id}`, data),
  updateSettlementExpense: async (settlementId: number, expenseId: number, data: {
    expectedVersion: number;
    buyAmount: number;
    sellAmount?: number;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    declarationNumber?: string | null;
    note?: string | null;
    adjustmentReason: string;
  }) => api.patch(`${FINANCIAL.ADVANCE_SETTLEMENTS}/${settlementId}/expenses/${expenseId}`, data),
  reverseAdvanceSettlement: async (id: number, data: { expectedVersion: number; reason: string }) => {
    return api.post(`${FINANCIAL.ADVANCE_SETTLEMENTS}/${id}/reversal`, data);
  },
};

/** Advance request attached to a trip/settlement detail (API response shape). */
export interface LinkedRequest {
  id: number;
  amount: string;
  reason: string;
  status: string;
  createdAt: string;
}

/** Trip expense attached to a settlement printout — superset of the list view's fields. */
export interface LinkedExpense {
  id: number;
  tripId: number;
  expenseType: string;
  buyAmount: string;
  sellAmount?: string;
  submittedBuyAmount?: string | null;
  adjustmentReason?: string | null;
  adjustedAt?: string | null;
  completionStatus?: string | null;
  containerNumber: string | null;
  invoiceNumber: string | null;
  note: string | null;
  tripCode: string | null;
  departureDate: string | null;
  customerName: string | null;
}

/** Paginated envelope of GET /forwarder/me/advance-requests (list page). */
export interface ForwarderAdvanceRequestsEnvelope {
  items: AdvanceRequestWithRefs[];
  page: number;
  limit: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Full-set counts per status (requester-scoped, status filter excluded). */
  statusCounts: Record<string, number>;
  /** Full-set amount totals per status (requester-scoped, status filter excluded). */
  statusAmounts: Record<string, number>;
  /** Route alias of statusCounts kept for legacy full-list consumers. */
  counts: Record<string, number>;
}

/** Paginated variant of `forwarderClient.getAdvanceRequests` for the /my-advances list page. */
export async function getAdvanceRequestsPaginated(params: {
  status?: string;
  page?: number;
  limit?: number;
}) {
  return api.get<ForwarderAdvanceRequestsEnvelope>(
    `${FORWARDER.ADVANCE_REQUESTS}${toQuery({ status: params?.status, page: params?.page, limit: params?.limit })}`,
  );
}
