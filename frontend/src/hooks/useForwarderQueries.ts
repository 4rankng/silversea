import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { forwarderClient } from '../api/forwarderClient';
import { financialClient } from '../api/financialClient';
import { qk } from '../api/keys';

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
      settlementMethod?: 'COMPANY_DIRECT' | 'FORWARDER_ADVANCE';
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
    mutationFn: ({ id, tripId: _tripId, ...data }: {
      id: number; tripId: number; expenseType: string; buyAmount: number; sellAmount?: number;
      settlementMethod?: 'COMPANY_DIRECT' | 'FORWARDER_ADVANCE'; supplierId?: number | null;
      expenseDate?: string | null; payeeName?: string | null;
      invoiceNumber?: string | null; invoiceDate?: string | null; declarationNumber?: string | null;
      tripContainerId?: number | null; note?: string | null; noInvoiceEvidenceTypes?: string[] | null;
    }) => forwarderClient.updateExpense(id, data),
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
    mutationFn: ({ id, tripId: _tripId }: { id: number; tripId: number }) =>
      forwarderClient.deleteExpense(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.forwarder.tripDetailAll });
    },
  });
}

// ── Advance Requests (forwarder) ──────────────────────────────────────────────

export function useForwarderAdvanceRequests(status?: string) {
  return useQuery({
    queryKey: qk.forwarder.advanceRequests(status),
    queryFn: () => forwarderClient.getAdvanceRequests(status),
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

export function useForwarderSettlements() {
  return useQuery({
    queryKey: qk.forwarder.settlements,
    queryFn: () => forwarderClient.getAdvanceSettlements(),
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

export function useAdminAdvanceRequests(filters?: { status?: string }) {
  return useQuery({
    queryKey: qk.adminForwarder.advanceRequests(filters),
    queryFn: () => forwarderClient.listAllAdvanceRequests(filters),
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
    mutationFn: (id: number) => forwarderClient.approveAdvanceRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.adminForwarder.advanceRequestsAll });
    },
  });
}

export function useRejectAdvanceRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => forwarderClient.rejectAdvanceRequest(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.adminForwarder.advanceRequestsAll });
    },
  });
}

// ── Admin: Advance Settlements ──────────────────────────────────────────────

export function useAdminSettlements(filters?: { status?: string }) {
  return useQuery({
    queryKey: qk.adminForwarder.settlements(filters),
    queryFn: () => forwarderClient.listAllAdvanceSettlements(filters),
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
    mutationFn: (id: number) => forwarderClient.checkAdvanceSettlement(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.adminForwarder.settlementsAll });
    },
  });
}

export function useApproveSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => forwarderClient.approveAdvanceSettlement(id),
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
    mutationFn: (id: number) => forwarderClient.rejectAdvanceSettlement(id),
    onSuccess: () => {
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
