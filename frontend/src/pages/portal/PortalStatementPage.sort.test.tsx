import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock } = vi.hoisted(() => ({
  apiMock: { get: vi.fn(), getBlob: vi.fn() },
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/api')>();
  return { ...original, api: apiMock };
});

vi.mock('./CustomerPortalScope', () => ({
  useCustomerPortalScope: () => ({ selectedCustomerId: null, ready: true }),
  withCustomerScope: (path: string) => path,
}));

import PortalStatementPage from './PortalStatementPage';

const ledgerRows = [
  { id: 3, timestamp: '2026-08-23T10:00:00.000Z', note: 'Cước chuyến C3', tripCode: null, txnType: 'TRIP_REVENUE', debit: '300000', credit: '0', balance: '900000' },
  { id: 2, timestamp: '2026-08-22T10:00:00.000Z', note: 'Cước chuyến C2', tripCode: null, txnType: 'TRIP_REVENUE', debit: '200000', credit: '0', balance: '600000' },
  { id: 1, timestamp: '2026-08-21T10:00:00.000Z', note: 'Thanh toán', tripCode: null, txnType: 'PAYMENT_RECEIVED', debit: '0', credit: '400000', balance: '400000' },
];

function renderPage() {
  return render(<PortalStatementPage />);
}

function noteColumn(): string[] {
  return screen.getAllByRole('row').slice(1).map((row) =>
    (row.querySelector('td[data-label="Nội dung"]')?.textContent ?? '').trim());
}

describe('PortalStatementPage ledger sort headers', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.get.mockResolvedValue({
      customer: { id: 1, name: 'Khách hàng A' },
      totalOutstanding: 900000,
      ledgerRows,
      unpaidTrips: [],
    });
  });

  it('keeps the server order first, then sorts by date asc → desc', async () => {
    renderPage();
    expect(await screen.findAllByText('Cước chuyến C3')).toBeTruthy();
    expect(noteColumn()).toEqual(['Cước chuyến C3', 'Cước chuyến C2', 'Thanh toán']);

    fireEvent.click(screen.getByRole('button', { name: 'Ngày' }));
    expect(noteColumn()).toEqual(['Thanh toán', 'Cước chuyến C2', 'Cước chuyến C3']);

    fireEvent.click(screen.getByRole('button', { name: 'Ngày' }));
    expect(noteColumn()).toEqual(['Cước chuyến C3', 'Cước chuyến C2', 'Thanh toán']);
  });

  it('sorts by note but keeps the running-balance money columns non-sortable', async () => {
    renderPage();
    expect(await screen.findAllByText('Cước chuyến C3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Nội dung' }));
    expect(noteColumn()).toEqual(['Cước chuyến C2', 'Cước chuyến C3', 'Thanh toán']);

    // The money/balance columns are intentionally plain headers: reordering a
    // running-balance ledger by amount would strip Số dư of its meaning.
    expect(screen.queryByRole('button', { name: 'Ghi nợ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thanh toán' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Số dư' })).toBeNull();
  });
});
