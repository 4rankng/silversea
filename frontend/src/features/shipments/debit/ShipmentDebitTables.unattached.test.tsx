// Card 20260924_3 — the display-only unattached-trips section. Pins: hidden
// at empty, verbatim fee rendering, totals untouched, chốt semantics visible.
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { UnattachedTripsTable } from './ShipmentDebitTables.unattached';

const trip = (over: Record<string, unknown> = {}) => ({
  tripId: 9001,
  tripCode: 'TRIP-26-0701',
  departureDate: '2026-09-20',
  status: 'DONE',
  chotIncluded: false as const,
  items: [
    { id: 71, expenseType: 'CUSTOMS_SUP', feeName: 'Hải quan giám sát', amount: 150000, thuKhach: 200000, note: null, invoiceNumber: 'HD-77' },
    { id: 72, expenseType: 'OTHER', feeName: null, amount: null, thuKhach: null, note: null, invoiceNumber: null },
  ],
  feeTotal: 150000,
  ...over,
});

describe('UnattachedTripsTable (card 20260924_3)', () => {
  it('renders nothing when the lot has no unattached trips (never zero-render)', () => {
    const { container } = render(<UnattachedTripsTable trips={[]} />);
    expect(container.querySelector('table')).toBeNull();
  });

  it('renders trip rows with business keys, fees, and the chốt semantics verbatim', () => {
    render(<UnattachedTripsTable trips={[trip()]} />);
    const table = document.querySelector('.csc-debit-table--unattached') as HTMLElement;
    expect(within(table).getByRole('caption', { name: 'Chuyến chưa gán đầu việc vận chuyển — chỉ hiển thị, không vào tổng chốt' })).toBeTruthy();
    expect(within(table).getAllByRole('cell', { name: 'TRIP-26-0701' }).length).toBeGreaterThan(0);
    expect(within(table).getByText('Hải quan giám sát')).toBeTruthy();
    expect(within(table).getAllByText('150.000')).toHaveLength(2); // item amount + feeTotal agree
    expect(within(table).getByText('Thu khách: 200.000')).toBeTruthy();
    expect(within(table).getByText('HD: HD-77')).toBeTruthy();
    expect(within(table).getByText('Chưa xác định')).toBeTruthy();
    expect(within(table).getByText('Ngoài chốt')).toBeTruthy();
  });

  it('falls back to expenseType when feeName is null', () => {
    render(<UnattachedTripsTable trips={[trip({ tripCode: null, departureDate: null, status: null })]} />);
    const table = document.querySelector('.csc-debit-table--unattached') as HTMLElement;
    expect(within(table).getByText('OTHER')).toBeTruthy();
    expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });
});

const originalMedia = window.matchMedia;
function phoneViewport() {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: query.includes('max-width: 640px'), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
}
afterEach(() => { window.matchMedia = originalMedia; });

it('QA-AUDIT-UI-39 phone unattached fees remain complete and outside chốt', () => {
  phoneViewport(); render(<UnattachedTripsTable trips={[trip()]} />);
  expect(screen.queryByRole('table')).toBeNull();
  const record = screen.getByRole('article', { name: 'TRIP-26-0701' });
  for (const value of ['2026-09-20', 'DONE', 'Ngoài chốt', 'Hải quan giám sát', 'Thu khách: 200.000', 'HD: HD-77', 'Chưa xác định']) {
    expect(within(record).getByText(value)).toBeTruthy();
  }
  expect(within(record).getAllByText('150.000')).toHaveLength(2);
  expect(within(record).getByText('Hải quan giám sát').closest('.ledger-record__fact')).toHaveAttribute('data-layout', 'full-width');
});
