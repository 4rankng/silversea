import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  financialClient,
  type CustomerAging,
  type CustomerAgingResponse,
  type FuelInvoice,
  type FuelInvoiceInput,
  type FuelInvoiceStatus,
  type GovernanceActionRecord,
  type GovernanceActionFilters,
} from '../api/financialClient';
import { qk } from '../api/keys';
import { tripClient } from '../api/tripClient';
import type { LedgerEntry, CustomerStatement as SharedCustomerStatement, PayablesCategory, SupplierStatement, TripDetail } from '@tingting/shared';

export type { CustomerAging };

export type CustomerStatement = SharedCustomerStatement;

export interface FuelInvoiceTripOption {
  id: number;
  tripCode: string | null;
  truckId: number | null;
  truckPlate: string | null;
  departureDate: string | null;
  routeName: string | null;
}

export const governanceActionKeys = {
  all: ['governance-actions'] as const,
  /** Full param bag (status/page/limit/…) keeps each request in its own cache entry. */
  list: (filters?: GovernanceActionFilters) =>
    ['governance-actions', filters ?? {}] as const,
};

export function useGovernanceActions(filters?: GovernanceActionFilters) {
  return useQuery({
    queryKey: governanceActionKeys.list(filters),
    queryFn: () => financialClient.getGovernanceActions(filters),
  });
}

function useGovernanceActionMutation(
  mutationFn: (input: { id: number; expectedVersion: number; reason?: string }) => Promise<GovernanceActionRecord>,
  refreshApprovedCompanyInfo = false,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (action) => {
      await qc.invalidateQueries({ queryKey: governanceActionKeys.all });
      if (refreshApprovedCompanyInfo && action.subjectKey === 'company-info') {
        await Promise.all([
          qc.invalidateQueries({ queryKey: qk.catalogs.companyInfo }),
          qc.invalidateQueries({ queryKey: qk.configCounts.companyInfo }),
        ]);
      }
    },
  });
}

export function useCheckGovernanceAction() {
  return useGovernanceActionMutation(({ id, expectedVersion }) =>
    financialClient.checkGovernanceAction(id, expectedVersion));
}

export function useApproveGovernanceAction() {
  return useGovernanceActionMutation(({ id, expectedVersion }) =>
    financialClient.approveGovernanceAction(id, expectedVersion), true);
}

export function useRejectGovernanceAction() {
  return useGovernanceActionMutation(({ id, expectedVersion, reason }) =>
    financialClient.rejectGovernanceAction(id, {
      expectedVersion,
      reason: reason ?? '',
    }));
}

export function useCustomerAging(params?: { search?: string; page?: number; limit?: number; bucket?: 'all' | 'current' | 'd30' | 'd60' | 'over90' }) {
  return useQuery<CustomerAgingResponse>({
    queryKey: qk.financial.customerAging(params),
    queryFn: () => financialClient.getCustomerAging(params),
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useCustomerStatement(
  id: string | undefined,
  range?: { dateFrom?: string; dateTo?: string },
) {
  return useQuery<CustomerStatement>({
    queryKey: qk.financial.customerStatement(id, range),
    enabled: !!id,
    queryFn: () => financialClient.getCustomerStatement(Number(id), range) as Promise<CustomerStatement>,
    placeholderData: keepPreviousData,
  });
}

export function useCustomerLedgerEntries() {
  return useQuery<LedgerEntry[]>({
    queryKey: qk.financial.customerLedgerEntries,
    queryFn: () => financialClient.getAllLedgerEntries({ entityType: 'CUSTOMER' }),
    staleTime: 2 * 60 * 1000,
  });
}

export function usePayablesSummary(params?: { category?: PayablesCategory; search?: string; page?: number; limit?: number }) {
  return useQuery({
    queryKey: qk.financial.payablesSummary(params),
    queryFn: () => financialClient.getPayablesSummary(params),
    placeholderData: keepPreviousData,
  });
}

export function useFuelInvoices(filters?: { supplierId?: number; status?: FuelInvoiceStatus }) {
  return useQuery<FuelInvoice[]>({
    queryKey: qk.financial.fuelInvoices(filters),
    queryFn: () => financialClient.getFuelInvoices(filters),
  });
}

export function useFuelInvoice(invoiceId: number | null) {
  return useQuery<FuelInvoice>({
    queryKey: qk.financial.fuelInvoice(invoiceId),
    queryFn: () => financialClient.getFuelInvoice(invoiceId!),
    enabled: invoiceId != null,
  });
}

export function useFuelInvoiceTripOptions() {
  return useQuery<FuelInvoiceTripOption[]>({
    queryKey: qk.financial.fuelInvoiceTripOptions,
    queryFn: async () => {
      const response = await tripClient.listTrips({ limit: 100 });
      return response.items.map((trip: TripDetail) => ({
        id: trip.id,
        tripCode: trip.tripCode ?? null,
        truckId: trip.truckId ?? null,
        truckPlate: trip.truck?.licensePlate ?? trip.externalPlateNumber ?? null,
        departureDate: trip.departureDate ?? null,
        routeName: trip.route?.name ?? null,
      }));
    },
    staleTime: 2 * 60 * 1000,
  });
}

/** Invalidate every cached payables-summary query, regardless of category. */
export function useInvalidatePayablesSummary() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: qk.financial.payablesSummaryAll });
}

function invalidateFuelInvoiceQueries(qc: ReturnType<typeof useQueryClient>, invoiceId?: number | null) {
  qc.invalidateQueries({ queryKey: qk.financial.fuelInvoicesAll });
  if (invoiceId != null) {
    qc.invalidateQueries({ queryKey: qk.financial.fuelInvoice(invoiceId) });
  }
  qc.invalidateQueries({ queryKey: qk.financial.payablesSummaryAll });
}

export function useCreateFuelInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: FuelInvoiceInput) => financialClient.createFuelInvoice(data),
    onSuccess: (created) => {
      invalidateFuelInvoiceQueries(qc, created.id);
    },
  });
}

export function useUpdateFuelInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data, expectedVersion }: { id: number; data: FuelInvoiceInput; expectedVersion: number }) =>
      financialClient.updateFuelInvoice(id, data, expectedVersion),
    onSuccess: (updated) => {
      invalidateFuelInvoiceQueries(qc, updated.id);
    },
  });
}

export function useApproveFuelInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion, reason }: { id: number; expectedVersion: number; reason: string }) =>
      financialClient.approveFuelInvoice(id, expectedVersion, reason),
    onSuccess: (action) => {
      if (action.subjectId != null) invalidateFuelInvoiceQueries(qc, action.subjectId);
      qc.invalidateQueries({ queryKey: qk.governance.actions });
    },
  });
}

/** Records a manual commission payable owed to a supplier. */
export function usePostCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { supplierId: number; amount: number; tripId?: number; note?: string }) =>
      financialClient.postCommission(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.financial.payablesSummaryAll });
    },
  });
}

/**
 * Records a driver salary/cash payout (B1 — feedback202606 GAP 4). Posts a
 * DRIVER_PAYOUT debit on the DRIVER ledger, reducing the company's payable
 * balance for that driver. Invalidates salary-list + driver-salary queries so
 * the "Đã thanh toán" / payable figures refresh.
 */
export function usePostDriverPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      driverId: number;
      amount: number;
      method: 'CASH' | 'BANK';
      payoutDate: string;
      note?: string;
      receiptId?: string;
    }) => financialClient.postDriverPayout(data.driverId, {
      amount: data.amount,
      method: data.method,
      payoutDate: data.payoutDate,
      note: data.note,
      receiptId: data.receiptId,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.salary.listAll });
      qc.invalidateQueries({ queryKey: qk.salary.driverSalaryAll });
    },
  });
}

export function useSupplierStatement(
  supplierId: number | undefined,
  range?: { dateFrom?: string; dateTo?: string },
  kind: 'vendor' | 'carrier' = 'vendor',
) {
  return useQuery<SupplierStatement>({
    queryKey: kind === 'carrier'
      ? qk.financial.carrierPayableStatement(supplierId, range)
      : qk.financial.supplierStatement(supplierId, range),
    queryFn: () => kind === 'carrier'
      ? financialClient.getCarrierPayableStatement(supplierId!, range)
      : financialClient.getSupplierStatement(supplierId!, range),
    enabled: !!supplierId,
    placeholderData: keepPreviousData,
  });
}

export function useExpenses(filters?: {
  truckId?: number;
  supplierId?: number;
  categoryId?: number;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: qk.financial.expenses(filters),
    queryFn: () => financialClient.getExpenses(filters),
  });
}
