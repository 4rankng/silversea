import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAccountingTransportRegisterMock = vi.hoisted(() => vi.fn());

vi.mock('../../api/customerServiceFinanceClient', () => ({
  customerServiceFinanceClient: {
    getAccountingTransportRegister: getAccountingTransportRegisterMock,
  },
}));

vi.mock('../../api/configClient', () => ({
  configClient: {
    getAllCustomers: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../lib/api', () => ({
  api: {
    // The overview queries fire regardless of the active tab; keep them quiet.
    get: vi.fn().mockResolvedValue({}),
  },
}));

import { AccountingWorkspaceRoot } from './AccountingWorkspaceRoot';

function registerRow(tripId: number, tripCode: string, revenue: string) {
  return {
    financialPostingId: tripId,
    financialPostingVersion: 1,
    financialPostingEffectiveAt: '2042-01-20T08:00:00.000Z',
    tripId,
    tripCode,
    completionDate: '2042-01-20',
    customerId: 1,
    customerName: 'Silver Sea',
    carrierId: null,
    carrierName: null,
    ownership: 'OWN',
    shipmentId: null,
    shipmentCode: null,
    routeId: 1,
    routeName: 'HP — HN',
    factoryName: null,
    containerNumbers: ['TGHU0000001'],
    containerTypes: ['40HC'],
    plateNumber: '30A-123.45',
    revenue,
    directCost: '50',
    carrierPayable: '0',
    profit: '50',
    readiness: {
      status: 'READY',
      acceptedPodSubmissionId: tripId,
      acceptedPodVersion: 1,
      acceptedPodAt: '2042-01-20T08:00:00.000Z',
      profitabilitySnapshotId: tripId,
      evidence: [],
    },
  };
}

const envelope = {
  asOf: '2042-01-31T08:00:00.000Z',
  timezone: 'Asia/Ho_Chi_Minh',
  filterFingerprint: 'a'.repeat(64),
  page: 1,
  limit: 25,
  total: 60,
  totalPages: 3,
  items: [registerRow(1, 'ATR-TRIP-20', '925926'), registerRow(2, 'ATR-TRIP-19', null)],
};

function lastParams(): Record<string, unknown> {
  const calls = getAccountingTransportRegisterMock.mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

function renderRoot(initialUrl: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <AccountingWorkspaceRoot />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getAccountingTransportRegisterMock.mockReset().mockResolvedValue(envelope);
});

describe('AccountingWorkspaceRoot transport register sort (URL-driven)', () => {
  it('loads without sort params and renders every data column as a sort header', async () => {
    renderRoot('/accounting?view=transport');
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Doanh thu' })).toBeTruthy());
    expect(lastParams()).toMatchObject({ page: 1 });
    expect(lastParams().sortBy).toBeUndefined();
    expect(lastParams().sortDir).toBeUndefined();
    for (const label of ['Chuyến', 'Khách hàng', 'Nhà xe', 'Doanh thu', 'Chi phí', 'Lợi nhuận', 'Trạng thái']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('header click writes sortBy/sortDir into the query and restarts from page 1', async () => {
    renderRoot('/accounting?view=transport&page=2');
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 2 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Doanh thu' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Doanh thu' }));
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 1, sortBy: 'revenue', sortDir: 'asc' }));
    expect(screen.getByRole('columnheader', { name: 'Doanh thu' }).getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: 'Doanh thu' }));
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 1, sortBy: 'revenue', sortDir: 'desc' }));
    expect(screen.getByRole('columnheader', { name: 'Doanh thu' }).getAttribute('aria-sort')).toBe('descending');
  });
});
