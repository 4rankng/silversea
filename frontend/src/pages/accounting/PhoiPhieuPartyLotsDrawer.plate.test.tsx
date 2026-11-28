import { render, screen } from '@testing-library/react';
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

// CR-011 §10.10.1 — the drill-down drawer gains the BIỂN KIỂM SOÁT column
// right after CONTAINER: OWN trips read trucks.licensePlate, external trips
// read tripCarrierInfo.externalPlateNumber (BE coalesce), and a plated lot
// renders its plate UNCUT — '15E-019.80' is one token in its track. SIL-874
// retest (wrap-wins): the uncut law rides the ppc-lots-token cell law (one
// line while the track holds the token, wraps INSIDE the cell when it cannot
// — never a bleed, never a clip), replacing the retired inline nowrap span.
const lot: PhoiPhieuPartyLot = {
  tripId: 7,
  shipmentId: 3,
  billOrBooking: 'BL-77',
  containerNumber: 'TEMU7712345',
  plateNumber: '15E-019.80',
  departureDate: '2026-11-20',
  tienNang: 1000,
  tienHa: 0,
  psKhac: 0,
  total: 1000,
  daThuTra: 0,
  conLai: 1000,
  party: 'Gaya Container Lines',
  ghiChu: null,
  entries: [{ sourceId: 91, expectedVersion: 1, amount: 1000, bucket: 'nang' }],
};

describe('PhoiPhieuPartyLotsDrawer — BIỂN KIỂM SOÁT column (CR-011)', () => {
  it('renders the plate right after the container, uncut', async () => {
    api.getPhoiPhieuPartyLots.mockResolvedValue({ items: [lot] });
    api.listPhoiPhieuStk.mockResolvedValue({ items: [] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PhoiPhieuPartyLotsDrawer kind="TRA" party="Gaya Container Lines" dateFrom="2026-11-01" dateTo="2026-11-30" onClose={() => {}} onIssued={() => {}} />
      </QueryClientProvider>,
    );
    await screen.findByText('TEMU7712345');
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toContain('Biển kiểm soát');
    // Column order: CONTAINER immediately before BIỂN KIỂM SOÁT.
    expect(headers.indexOf('Container')).toBe(headers.indexOf('Biển kiểm soát') - 1);
    // The plate prints whole — the em-plate '15E-019.80' is one text node,
    // in the token cell that keeps it one line while it fits.
    const cell = screen.getByText('15E-019.80');
    expect(cell.textContent).toBe('15E-019.80');
    expect(cell.closest('td')).toHaveClass('ppc-lots-token');
  });

  it('a lot without a plate reads the house dash, not an empty cell', async () => {
    api.getPhoiPhieuPartyLots.mockResolvedValue({ items: [{ ...lot, tripId: 8, plateNumber: null }] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PhoiPhieuPartyLotsDrawer kind="TRA" party="Gaya Container Lines" dateFrom="2026-11-01" dateTo="2026-11-30" onClose={() => {}} onIssued={() => {}} />
      </QueryClientProvider>,
    );
    await screen.findByText('TEMU7712345');
    // The plate cell prints the house dash — target it by its neighbour, the
    // container token cell, not by a styling mechanism.
    const containerCell = screen.getByText('TEMU7712345').closest('td');
    expect(containerCell?.nextElementSibling).toHaveTextContent('—');
  });
});
