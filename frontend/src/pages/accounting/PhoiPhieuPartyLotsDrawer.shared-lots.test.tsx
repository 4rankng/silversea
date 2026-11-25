import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getPhoiPhieuPartyLots: vi.fn(), listPhoiPhieuStk: vi.fn(), createPhoiPhieuVoucher: vi.fn() }));
vi.mock('../../api/phoiPhieuClient', () => ({
  getPhoiPhieuPartyLots: api.getPhoiPhieuPartyLots,
  listPhoiPhieuStk: api.listPhoiPhieuStk,
  createPhoiPhieuVoucher: api.createPhoiPhieuVoucher,
}));

import { PhoiPhieuPartyLotsDrawer } from './PhoiPhieuPartyLotsDrawer';
import type { PhoiPhieuPartyLot } from '../../api/phoiPhieuClient';

// SIL-1027 (K6.6) — the 'Phí chung lô (chưa gắn chuyến)' block must read as
// the same money table as the trip lots: số tiền and còn lại as COLUMNS plus
// the Ghi chú column — never the bare 'bill · total · còn lại …' inline list.
const sharedLot: PhoiPhieuPartyLot = {
  tripId: null,
  shipmentId: 3,
  billOrBooking: 'YMJAI226573788',
  containerNumber: null,
  plateNumber: null,
  departureDate: null,
  tienNang: 0,
  tienHa: 500000,
  psKhac: 0,
  total: 500000,
  daThuTra: 0,
  conLai: 500000,
  ghiChu: 'Ghi chú thử',
  entries: [],
};

function renderDrawer(kind: 'THU' | 'TRA') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhoiPhieuPartyLotsDrawer kind={kind} party="LONG MINH" dateFrom="2026-11-01" dateTo="2026-11-30" onClose={() => {}} onIssued={() => {}} />
    </QueryClientProvider>,
  );
}

describe('PhoiPhieuPartyLotsDrawer — phí chung lô as a money table (SIL-1027)', () => {
  it('renders each shared lot as a table row with money columns and the composed Ghi chú (PHẢI THU)', async () => {
    api.getPhoiPhieuPartyLots.mockResolvedValue({ items: [sharedLot] });
    api.listPhoiPhieuStk.mockResolvedValue({ items: [] });
    renderDrawer('THU');
    await screen.findByText('YMJAI226573788');

    // The shared block carries real money/note column headers — kind-aware
    // exactly like the trip-lot table ('Phải thu' / 'Đã thu' on the THU side).
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    for (const label of ['Số Bill / Booking', 'Phải thu', 'Đã thu', 'Còn lại', 'Ghi chú']) {
      expect(headers).toContain(label);
    }

    // The shared lot is a TABLE ROW — the bill, the amounts and the note all
    // land in cells of one row (one row per shared lot).
    const rows = screen.getAllByRole('row').filter((row) => row.textContent?.includes('YMJAI226573788'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('500.000');
    expect(screen.getByText('Ghi chú thử').closest('td')).not.toBeNull();

    // The bare inline list is gone: nothing glues 'bill · total · còn lại'
    // into one text node any more.
    expect(document.body.textContent).not.toContain('YMJAI226573788 · 500.000 · còn lại 500.000');
    expect(screen.queryByText(/còn lại 500\.000/)).toBeNull();
  });

  it('reads kind-aware money headers and the house dash for a lot without a Ghi chú (PHẢI TRẢ)', async () => {
    api.getPhoiPhieuPartyLots.mockResolvedValue({ items: [{ ...sharedLot, ghiChu: null, containerNumber: 'TCLU1234567' }] });
    api.listPhoiPhieuStk.mockResolvedValue({ items: [] });
    renderDrawer('TRA');
    await screen.findByText('YMJAI226573788');

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toContain('Phải trả');
    expect(headers).toContain('Đã trả');

    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('YMJAI226573788'))!;
    expect(row).toBeTruthy();
    // This row fills every cell but Ghi chú — its lone dash is the note's
    // `lot.ghiChu ?? '—'` fallback, and it sits in a table cell.
    const dash = within(row).getByText('—');
    expect(dash.closest('td')).not.toBeNull();
  });
});
