import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FuelNormsConfigPage from './FuelNormsConfigPage';
import RoadAllowancesConfigPage from './RoadAllowancesConfigPage';
import LiftPricingConfigPage from './LiftPricingConfigPage';
import PricingTablesConfigPage from './PricingTablesConfigPage';
import FreightRateTermsConfigPage from './FreightRateTermsConfigPage';

interface MockCrudProps {
  renderForm?: (props: { saving: boolean; onSave: () => void; onCancel: () => void }) => ReactNode;
}

const mocks = vi.hoisted(() => ({
  routesQuery: { data: [] as Array<{ id: number; name: string; shortName?: string }>, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  portsQuery: { data: [] as Array<{ id: number; name: string }>, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  containerTypesQuery: { data: [] as Array<{ id: number; code: string; name: string }>, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  customersQuery: { data: [] as Array<{ id: number; name: string; shortName?: string }>, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  lastCrudProps: null as MockCrudProps | null,
}));

vi.mock('../../components/config/CrudTable', () => ({
  CrudTable: (props: MockCrudProps) => {
    mocks.lastCrudProps = props;
    return (
      <div data-testid="crud-table">
        {props.renderForm?.({ saving: false, onSave: vi.fn(), onCancel: vi.fn() })}
      </div>
    );
  },
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../hooks/useCatalogQueries', () => ({
  useRoutesDropdown: () => mocks.routesQuery,
  usePorts: () => mocks.portsQuery,
  useContainerTypes: () => mocks.containerTypesQuery,
  useAllCustomers: () => mocks.customersQuery,
}));

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('CrudTable dropdown feeds error handling (card 20261004_337 Group 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.routesQuery = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
    mocks.portsQuery = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
    mocks.containerTypesQuery = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
    mocks.customersQuery = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  });

  it('FuelNormsConfigPage: renders feed error alert and disables routes select on error', () => {
    mocks.routesQuery.isError = true;
    render(<FuelNormsConfigPage />, { wrapper: makeWrapper() });
    expect(screen.getByRole('alert')).toHaveTextContent('Không thể tải danh mục tuyến đường.');
    const retryBtn = screen.getByRole('button', { name: 'Thử lại' });
    fireEvent.click(retryBtn);
    expect(mocks.routesQuery.refetch).toHaveBeenCalled();
  });

  it('RoadAllowancesConfigPage: renders feed error alert and disables routes select on error', () => {
    mocks.routesQuery.isError = true;
    render(<RoadAllowancesConfigPage />, { wrapper: makeWrapper() });
    expect(screen.getByRole('alert')).toHaveTextContent('Không thể tải danh mục tuyến đường.');
    const retryBtn = screen.getByRole('button', { name: 'Thử lại' });
    fireEvent.click(retryBtn);
    expect(mocks.routesQuery.refetch).toHaveBeenCalled();
  });

  it('LiftPricingConfigPage: renders feed error alert when ports or container types fail', () => {
    mocks.portsQuery.isError = true;
    render(<LiftPricingConfigPage />, { wrapper: makeWrapper() });
    expect(screen.getByRole('alert')).toHaveTextContent('Không thể tải danh mục cảng / bãi.');
    const retryBtn = screen.getByRole('button', { name: 'Thử lại' });
    fireEvent.click(retryBtn);
    expect(mocks.portsQuery.refetch).toHaveBeenCalled();
  });

  it('PricingTablesConfigPage: renders feed error alert when customers feed fails', () => {
    mocks.customersQuery.isError = true;
    render(<PricingTablesConfigPage />, { wrapper: makeWrapper() });
    expect(screen.getByRole('alert')).toHaveTextContent('Không thể tải danh sách khách hàng.');
    const retryBtn = screen.getByRole('button', { name: 'Thử lại' });
    fireEvent.click(retryBtn);
    expect(mocks.customersQuery.refetch).toHaveBeenCalled();
  });

  it('FreightRateTermsConfigPage: renders feed error alert when customers or routes feed fails', () => {
    mocks.routesQuery.isError = true;
    render(<FreightRateTermsConfigPage />, { wrapper: makeWrapper() });
    expect(screen.getByRole('alert')).toHaveTextContent('Không thể tải danh mục tuyến đường.');
    const retryBtn = screen.getByRole('button', { name: 'Thử lại' });
    fireEvent.click(retryBtn);
    expect(mocks.routesQuery.refetch).toHaveBeenCalled();
  });
});
