import { api } from '../lib/api';
import { toQuery } from '../lib/http/query';
import { FORWARDER, FINANCIAL } from '@tingting/shared';
import type {
  ForwarderTripDetail,
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
      items: Array<{
        id: number;
        tripCode: string | null;
        departureDate: string;
        status: string;
        routeName: string | null;
        truckPlate: string | null;
        customerName: string | null;
        customerReference: string | null;
        containerCount: number | null;
        containerNumbers: string | null;
        cargoTypeName: string | null;
        /** N4: derived payment/approval state for row coloring. */
        statusColor: 'paid' | 'pending' | 'none';
      }>;
      counts: Record<string, number>;
    }>(`${FORWARDER.TRIPS}${toQuery({ status, search: filters?.search, dateFrom: filters?.dateFrom, dateTo: filters?.dateTo })}`);
  },

  getTripDetail: async (id: number) => {
    return api.get<ForwarderTripDetail>(FORWARDER.TRIP_DETAIL(id));
  },

  listSuppliers: async () => {
    return api.get<{ items: Array<{ id: number; name: string; contactPerson: string | null; phone: string | null }> }>(FORWARDER.SUPPLIERS);
  },

  createContainer: async (tripId: number, data: { containerTypeId?: number; containerNumber: string; sealNumber?: string; notes?: string }) => {
    return api.post(FORWARDER.CONTAINERS(tripId), data);
  },

  createExpense: async (data: {
    tripId: number;
    expenseType: string;
    buyAmount: number;
    sellAmount?: number;
    settlementMethod?: 'COMPANY_DIRECT' | 'FORWARDER_ADVANCE';
    supplierId?: number;
    invoiceNumber?: string;
    invoiceDate?: string;
    declarationNumber?: string;
    containerNumber?: string;
    /** B5: authoritative container FK (id). When set the server mirrors containerNumber. */
    tripContainerId?: number;
    note?: string;
  }) => {
    return api.post(FORWARDER.EXPENSES, data);
  },

  updateExpense: async (id: number, data: {
    expenseType: string;
    buyAmount: number;
    sellAmount?: number;
    settlementMethod?: 'COMPANY_DIRECT' | 'FORWARDER_ADVANCE';
    supplierId?: number | null;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    declarationNumber?: string | null;
    tripContainerId?: number | null;
    note?: string | null;
  }) => api.patch(`/forwarder/me/expenses/${id}`, data),

  setExpenseCompletion: async (tripId: number, data: { tripContainerId: number | null; completed: boolean }) =>
    api.put(`/forwarder/me/trips/${tripId}/expense-completion`, data),

  deleteExpense: async (id: number) => {
    return api.delete(FORWARDER.EXPENSE(id));
  },

  getAdvanceRequests: async (status?: string) => {
    return api.get<{ items: AdvanceRequestWithRefs[]; counts: Record<string, number> }>(`${FORWARDER.ADVANCE_REQUESTS}${toQuery({ status })}`);
  },
  getEligibleAdvanceRequests: async () => {
    return api.get<{ items: AdvanceRequestWithRefs[]; counts: Record<string, number> }>(
      `${FORWARDER.ADVANCE_REQUESTS}${toQuery({ status: 'APPROVED', eligibleForSettlement: true })}`,
    );
  },
  createAdvanceRequest: async (data: { amount: number; reason: string }) => {
    return api.post(FORWARDER.ADVANCE_REQUESTS, data);
  },

  getAdvanceBalance: async () => {
    return api.get<{ outstanding: string }>(FORWARDER.ADVANCE_BALANCE);
  },

  getAdvanceSettlements: async () => {
    return api.get<{ items: AdvanceSettlementWithRefs[] }>(FORWARDER.ADVANCE_SETTLEMENTS);
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

  listAllAdvanceRequests: async (filters?: { status?: string }) => {
    return api.get<{ items: AdvanceRequestWithRefs[] }>(`${FINANCIAL.ADVANCE_REQUESTS}${toQuery(filters)}`);
  },
  approveAdvanceRequest: async (id: number) => {
    return api.post(FINANCIAL.ADVANCE_REQUEST_APPROVE(id), {});
  },
  rejectAdvanceRequest: async (id: number) => {
    return api.post(FINANCIAL.ADVANCE_REQUEST_REJECT(id), {});
  },

  listAllAdvanceSettlements: async (filters?: { status?: string }) => {
    return api.get<{ items: AdvanceSettlementWithRefs[] }>(`${FINANCIAL.ADVANCE_SETTLEMENTS}${toQuery(filters)}`);
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
  checkAdvanceSettlement: async (id: number) => {
    return api.post(FINANCIAL.ADVANCE_SETTLEMENT_CHECK(id), {});
  },
  approveAdvanceSettlement: async (id: number) => {
    return api.post(FINANCIAL.ADVANCE_SETTLEMENT_APPROVE(id), {});
  },
  updateAdvanceSettlement: async (id: number, data: {
    advanceRequestIds: number[];
    tripExpenseIds: number[];
    refundAmount: number;
    note?: string | null;
  }) => api.put<AdvanceSettlementWithRefs>(`${FINANCIAL.ADVANCE_SETTLEMENTS}/${id}`, data),
  updateSettlementExpense: async (settlementId: number, expenseId: number, data: {
    buyAmount: number;
    sellAmount?: number;
    invoiceNumber?: string | null;
    invoiceDate?: string | null;
    declarationNumber?: string | null;
    note?: string | null;
    adjustmentReason: string;
  }) => api.patch(`${FINANCIAL.ADVANCE_SETTLEMENTS}/${settlementId}/expenses/${expenseId}`, data),
  rejectAdvanceSettlement: async (id: number) => {
    return api.post(FINANCIAL.ADVANCE_SETTLEMENT_REJECT(id), {});
  },
};
