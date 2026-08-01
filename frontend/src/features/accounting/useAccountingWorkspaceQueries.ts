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
      }),
    enabled: state.activeView === 'transport',
  });

  const transportParties = useQuery({
    queryKey: qk.catalogs.allCustomers,
    queryFn: () => configClient.getAllCustomers(),
    staleTime: 5 * 60 * 1000,
    enabled: state.activeView === 'transport',
  });

  return {
    receivables,
    payables,
    profitability,
    transportRegister,
    transportParties,
    hasOverviewError:
      receivables.isError || payables.isError || profitability.isError,
  };
}
