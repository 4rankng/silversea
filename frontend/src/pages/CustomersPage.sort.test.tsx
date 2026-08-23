import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Customer } from '@tingting/shared';

const { apiMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, api: apiMock };
});

vi.mock('../hooks/useQueries', () => ({
  useCustomerLedgerEntries: () => ({ data: [] }),
  useSuppliers: () => ({ data: { items: [], total: 0 } }),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import CustomersPage from './CustomersPage';

function customerFixture(id: number, shortName: string): Customer {
  return {
    id,
    name: `Công ty ${shortName}`,
    shortName,
    taxCode: null,
    contactPerson: null,
    phone: null,
    creditLimit: null,
    paymentTermDays: 30,
    fuelSurchargeSharePct: null,
    paymentDatePolicy: 'NEXT_BUSINESS_DAY',
    status: 'ACTIVE',
    isCarrier: false,
    debitNoteMode: 'MONTHLY',
    linkedSupplierId: null,
  } as unknown as Customer;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function lastGetUrl(): string {
  const calls = apiMock.get.mock.calls;
  return String(calls[calls.length - 1]![0]);
}

describe('CustomersPage server-side sort headers', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    // 12 total at pageSize 10 → two pages, so the page-reset proof can run.
    apiMock.get.mockResolvedValue({
      items: [customerFixture(1, 'Biển Bạc'), customerFixture(2, 'Cát Tuyền')],
      total: 12,
    });
  });

  it('sends sortBy/sortDir to the endpoint, toggles asc→desc, and resets to page 1', async () => {
    renderPage();
    expect(await screen.findAllByText('Biển Bạc')).toBeTruthy();

    // Move to page 2 so the sort click's page reset is observable.
    fireEvent.click(await screen.findByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(lastGetUrl()).toContain('page=2'));

    // First click: fresh column starts ascending and jumps back to page 1.
    fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
    await waitFor(() => {
      expect(lastGetUrl()).toContain('page=1');
      expect(lastGetUrl()).toContain('sortBy=name');
      expect(lastGetUrl()).toContain('sortDir=asc');
    });

    // Second click on the active column flips to descending.
    fireEvent.click(screen.getByRole('button', { name: 'Khách hàng' }));
    await waitFor(() => {
      expect(lastGetUrl()).toContain('sortDir=desc');
      expect(lastGetUrl()).toContain('page=1');
    });
  });

  it('exposes each data column\'s backend sort key through its header button', async () => {
    renderPage();
    expect(await screen.findAllByText('Biển Bạc')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Công nợ' }));
    await waitFor(() => {
      expect(lastGetUrl()).toContain('sortBy=debt');
      expect(lastGetUrl()).toContain('sortDir=asc');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Hạn mức TD' }));
    await waitFor(() => expect(lastGetUrl()).toContain('sortBy=creditLimit'));

    fireEvent.click(screen.getByRole('button', { name: 'Liên hệ' }));
    await waitFor(() => expect(lastGetUrl()).toContain('sortBy=contactPerson'));

    // The active column announces direction; inactive columns announce none.
    // (Query via the header buttons — the bare label text also appears in the
    // mobile card list.)
    const header = screen.getByRole('button', { name: 'Liên hệ' }).closest('th');
    expect(header?.getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('button', { name: 'Hạn mức TD' }).closest('th')?.getAttribute('aria-sort')).toBe('none');
  });

  it('omits sort params entirely until a header is pressed', async () => {
    renderPage();
    expect(await screen.findAllByText('Biển Bạc')).toBeTruthy();
    expect(lastGetUrl()).not.toContain('sortBy');
    expect(lastGetUrl()).not.toContain('sortDir');
  });
});
