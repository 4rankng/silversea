import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { forwarderClient, getAdvanceRequestsPaginated, type ForwarderAdvanceRequestsEnvelope } from '../api/forwarderClient';
import { financialClient } from '../api/financialClient';
import { qk } from '../api/keys';
import { useTableQueryState } from '../design-system/hooks/useTableQueryState';
import type { AdvanceRequestStatus, AdvanceRequestWithRefs } from '@tingting/shared';

export function useForwarderTrips(
  status?: string,
  filters?: { search?: string; dateFrom?: string; dateTo?: string },
) {
  return useQuery({
    queryKey: qk.forwarder.trips(status, filters),
    queryFn: () => forwarderClient.getTrips(status, filters),
  });
}

export function useForwarderTripDetail(id: number) {
  return useQuery({
    queryKey: qk.forwarder.tripDetail(id),
    queryFn: () => forwarderClient.getTripDetail(id),
    enabled: !!id,
  });
}

export function useCreateForwarderContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: number; data: { containerTypeId?: number; containerNumber: string; sealNumber?: string; notes?: string } }) =>
      forwarderClient.createContainer(tripId, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: qk.forwarder.tripDetail(variables.tripId) });
    },
  });
}

export function useCreateForwarderExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
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
      note?: string;
      noInvoiceEvidenceTypes?: string[];
    }) =>
      forwarderClient.createExpense(data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: qk.forwarder.tripDetail(variables.tripId) });
    },
  });
}

export function useUpdateForwarderExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tripId: _tripId, expectedUpdatedAt, ...data }: {
      id: number; tripId: number; expectedUpdatedAt: string; expenseType: string; buyAmount: number; sellAmount?: number;
      settlementMethod?: 'COMPANY_DIRECT' | 'OPS_ADVANCE'; supplierId?: number | null;
      expenseDate?: string | null; payeeName?: string | null;
      invoiceNumber?: string | null; invoiceDate?: string | null; declarationNumber?: string | null;
      tripContainerId?: number | null; note?: string | null; noInvoiceEvidenceTypes?: string[] | null;
    }) => forwarderClient.updateExpense(id, expectedUpdatedAt, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: qk.forwarder.tripDetail(variables.tripId) });
      qc.invalidateQueries({ queryKey: qk.forwarder.unlinkedExpenses });
    },
  });
}

export function useSetForwarderExpenseCompletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, tripContainerId, completed }: { tripId: number; tripContainerId: number | null; completed: boolean }) =>
      forwarderClient.setExpenseCompletion(tripId, { tripContainerId, completed }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: qk.forwarder.tripDetail(variables.tripId) });
      qc.invalidateQueries({ queryKey: qk.forwarder.unlinkedExpenses });
    },
  });
}

export function useDeleteForwarderExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tripId: _tripId, expectedUpdatedAt }: { id: number; tripId: number; expectedUpdatedAt: string }) =>
      forwarderClient.deleteExpense(id, expectedUpdatedAt),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.forwarder.tripDetailAll });
    },
  });
}

// ── Advance Requests (forwarder) ──────────────────────────────────────────────

/**
 * Paginated table state for the forwarder's own advance-requests list
 * (/my-advances). statusCounts/statusAmounts in the envelope are full-set
 * aggregates, so KPIs and filter pills stay stable across tabs and pages.
 */
export function useForwarderAdvanceRequestsTable() {
  return useTableQueryState<
    AdvanceRequestWithRefs,
    { status?: AdvanceRequestStatus },
    ForwarderAdvanceRequestsEnvelope
  >({
    endpoint: getAdvanceRequestsPaginated,
    queryKey: qk.forwarder.advanceRequestsTable(),
    defaultPageSize: 25,
  });
}

export function useForwarderEligibleAdvanceRequests() {
  return useQuery({
    queryKey: qk.forwarder.eligibleAdvanceRequests,
    queryFn: () => forwarderClient.getEligibleAdvanceRequests(),
  });
}

export function useForwarderAdvanceBalance() {
  return useQuery({
    queryKey: qk.forwarder.advanceBalance,
    queryFn: () => forwarderClient.getAdvanceBalance(),
  });
}

export function useCreateAdvanceRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { amount: number; reason: string }) =>
      forwarderClient.createAdvanceRequest(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.forwarder.forwarderAdvanceRequestsAll });
    },
  });
}

// ── Advance Settlements (forwarder) ──────────────────────────────────────────

export function useForwarderSettlements(params?: { status?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: qk.forwarder.settlementsList(params),
    queryFn: () => forwarderClient.getAdvanceSettlements(params),
    placeholderData: keepPreviousData,
  });
}

export function useForwarderSettlementDetail(id: number) {
  return useQuery({
    queryKey: qk.forwarder.settlementDetail(id),
    queryFn: () => forwarderClient.getAdvanceSettlementDetail(id),
    enabled: !!id,
  });
}

export function useCreateAdvanceSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { totalExpenseAmount?: number; refundAmount?: number; note?: string; advanceRequestIds: number[]; tripExpenseIds?: number[] }) =>
      forwarderClient.createAdvanceSettlement(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.forwarder.settlements });
      qc.invalidateQueries({ queryKey: qk.forwarder.forwarderAdvanceRequestsAll });
      qc.invalidateQueries({ queryKey: qk.forwarder.unlinkedExpenses });
    },
  });
}

export function useUnlinkedExpenses() {
  return useQuery({
    queryKey: qk.forwarder.unlinkedExpenses,
    queryFn: () => forwarderClient.getUnlinkedExpenses(),
  });
}

// ── Admin: Advance Requests ──────────────────────────────────────────────────

export function useAdminAdvanceRequests(params?: { status?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: qk.adminForwarder.advanceRequests(params),
    queryFn: () => forwarderClient.listAllAdvanceRequests(params),
  });
}

export function useAdminAdvanceBalances() {
  return useQuery({
    queryKey: qk.adminForwarder.advanceBalances,
    queryFn: () => financialClient.getAdvanceBalances(),
  });
}

export function useApproveAdvanceRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion, reason }: { id: number; expectedVersion: number; reason: string }) =>
      forwarderClient.approveAdvanceRequest(id, expectedVersion, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.adminForwarder.advanceRequestsAll });
    },
  });
}

export function useRejectAdvanceRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion, reason }: { id: number; expectedVersion: number; reason: string }) =>
      forwarderClient.rejectAdvanceRequest(id, expectedVersion, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.adminForwarder.advanceRequestsAll });
    },
  });
}

// ── Admin: Advance Settlements ──────────────────────────────────────────────

export function useAdminSettlements(params?: { status?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: qk.adminForwarder.settlements(params),
    queryFn: () => forwarderClient.listAllAdvanceSettlements(params),
  });
}

export function useAdminSettlementOpsCompletion(settlementIds: number[]) {
  return useQuery({
    queryKey: qk.adminForwarder.settlementOpsCompletion(settlementIds),
    queryFn: () => forwarderClient.getSettlementOpsCompletion(settlementIds),
    enabled: settlementIds.length > 0,
  });
}

export function useCheckSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: number; expectedVersion: number }) =>
      forwarderClient.checkAdvanceSettlement(id, expectedVersion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.adminForwarder.settlementsAll });
    },
  });
}

export function useApproveSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: number; expectedVersion: number }) =>
      forwarderClient.approveAdvanceSettlement(id, expectedVersion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.adminForwarder.settlementsAll });
    },
  });
}

export function useUpdateAdvanceSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ settlementId, ...data }: {
      settlementId: number;
      expectedVersion: number;
      advanceRequestIds: number[];
      tripExpenseIds: number[];
      refundAmount: number;
      note?: string | null;
    }) => forwarderClient.updateAdvanceSettlement(settlementId, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: qk.adminForwarder.settlementDetail(variables.settlementId) });
      qc.invalidateQueries({ queryKey: qk.adminForwarder.settlementsAll });
    },
  });
}

export function useUpdateSettlementExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ settlementId, expenseId, ...data }: {
      settlementId: number; expenseId: number; buyAmount: number; sellAmount?: number;
      expectedVersion: number;
      invoiceNumber?: string | null; invoiceDate?: string | null; declarationNumber?: string | null;
      note?: string | null; adjustmentReason: string;
    }) => forwarderClient.updateSettlementExpense(settlementId, expenseId, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: qk.adminForwarder.settlementDetail(variables.settlementId) });
      qc.invalidateQueries({ queryKey: qk.adminForwarder.settlementsAll });
    },
  });
}

export function useRejectSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: number; expectedVersion: number }) =>
      forwarderClient.rejectAdvanceSettlement(id, expectedVersion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.adminForwarder.settlementsAll });
    },
  });
}

export function useReverseAdvanceSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion, reason }: { id: number; expectedVersion: number; reason: string }) =>
      forwarderClient.reverseAdvanceSettlement(id, { expectedVersion, reason }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: qk.adminForwarder.settlementDetail(variables.id) });
      qc.invalidateQueries({ queryKey: qk.adminForwarder.settlementsAll });
    },
  });
}

// ── Admin: Settlement detail (for print/export page) ─────────────────────────

export function useAdminSettlementDetail(id: number) {
  return useQuery({
    queryKey: qk.adminForwarder.settlementDetail(id),
    queryFn: () => financialClient.getAdminSettlementDetail(id),
    enabled: !!id,
  });
}
