import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { customerServiceFinanceClient } from '../../api/customerServiceFinanceClient';
import { configClient } from '../../api/configClient';
import { qk } from '../../api/keys';
import type { AccountingWorkspaceUrlState } from './accountingWorkspaceTypes';
import type {
  PayablesSummary,
  ProfitabilitySummary,
  ReceivablesSummary,
} from './accountingWorkspaceTypes';

export function useAccountingWorkspaceQueries(state: AccountingWorkspaceUrlState) {
  const receivables = useQuery({
    queryKey: qk.accounting.receivables(state.to),
    queryFn: () =>
      api.get<ReceivablesSummary>(
        `/reports/receivables-summary?asOfDate=${encodeURIComponent(state.to)}`,
      ),
  });

  const payables = useQuery({
    queryKey: qk.accounting.payables(state.to),
    queryFn: () =>
      api.get<PayablesSummary>(
        `/reports/payables-summary?asOfDate=${encodeURIComponent(state.to)}`,
      ),
  });

  const profitability = useQuery({
    queryKey: qk.accounting.profitability(state.month, state.year),
    queryFn: () =>
      api.get<ProfitabilitySummary>(
        `/reports/profitability?month=${state.month}&year=${state.year}&dimension=CUSTOMER&page=1&limit=1`,
      ),
  });

  const transportRegister = useQuery({
    queryKey: qk.accounting.transportRegister({
      from: state.from,
      to: state.to,
      page: state.transportPage,
      search: state.appliedTransportSearch,
      customerId: state.customerId ?? null,
      carrierId: state.carrierId ?? null,
      ownership: state.ownership ?? '',
      readiness: state.readiness ?? '',
      sortBy: state.transportSortBy ?? '',
      sortDir: state.transportSortDir ?? '',
    }),
    queryFn: () =>
      customerServiceFinanceClient.getAccountingTransportRegister({
        from: state.from,
        to: state.to,
        page: state.transportPage,
        limit: 25,
        search: state.appliedTransportSearch || undefined,
        customerId: state.customerId,
        carrierId: state.carrierId,
        ownership: state.ownership,
        readiness: state.readiness,
        sortBy: state.transportSortBy,
        sortDir: state.transportSortDir,
      }),
    enabled: state.activeView === 'transport',
  });

  // The two populations come from two different sources on purpose: the
  // customers list serves billing parties (non-carriers only since 2026-10-03)
  // while the carrier filter must enumerate nhà xe, which live in
  // customers.isCarrier. bootstrap.externalCarriers is that carrier list —
  // reading both out of one unfiltered array is what made them merge.
  const transportCustomers = useQuery({
    queryKey: qk.catalogs.allCustomers,
    queryFn: () => configClient.getAllCustomers(),
    staleTime: 5 * 60 * 1000,
    enabled: state.activeView === 'transport',
  });

  const transportCarriers = useQuery({
    queryKey: qk.allCarriers,
    queryFn: () => configClient.getAllCarriers(),
    staleTime: 5 * 60 * 1000,
    enabled: state.activeView === 'transport',
  });

  return {
    receivables,
    payables,
    profitability,
    transportRegister,
    transportCustomers,
    transportCarriers,
    hasOverviewError:
      receivables.isError || payables.isError || profitability.isError,
  };
}
