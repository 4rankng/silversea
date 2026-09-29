import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/phoiPhieuClient', () => ({
  listPhoiPhieuRows: vi.fn(),
  listPhoiPhieuStk: vi.fn(),
  listPhoiPhieuTruckAssignments: vi.fn(),
  getPhoiPhieuReport: vi.fn(),
  assignPhoiPhieuTruckAccountant: vi.fn(),
  createPhoiPhieuVoucher: vi.fn(),
}));

import PhoiPhieuControlPage from './PhoiPhieuControlPage';
import * as client from '../../api/phoiPhieuClient';
import type { PhoiPhieuRow } from '../../api/phoiPhieuClient';

/** Card 20260929_207 — the checkbox column is gone; a row IS the control.
 *  These cases pin the behaviour that replaces it, so a later refactor cannot
 *  quietly take the selection away (or make a row's own button select it). */

const row = (over: Partial<PhoiPhieuRow>): PhoiPhieuRow => ({
  tripId: 1,
  tripCode: 'TRP-1',
  shipmentId: 11,
  shipmentCode: 'SHP-1',
  billOrBooking: null,
  customerName: 'KH A',
  routeName: 'Tuyến A',
  containerNumber: 'CONT-1',
  containerTypeLabel: "40'HC",
  cargoWeightKg: 1000,
  // Card 20260928_172 — the type's rated capacity, distinct from cargo weight.
  containerPayloadKg: 26500,
  liftSite: 'Lạch Huyện',
  dropSite: 'Cát Hải',
  plateNumber: '60C-1',
  driverName: 'Tài xế A',
  departureDate: '2026-09-29',
  tripStatus: 'IN_TRANSIT',
  chiHoThu: 100,
  chiHoTra: 0,
  tienDuong: 50,
  eligibleIn: 0,
  eligibleOut: 1,
  cusDispatchNotes: [],
  driverNote: null,
  confirmable: true,
  openSources: [],
  ...over,
});

function renderBoard(items: PhoiPhieuRow[]) {
  vi.mocked(client.listPhoiPhieuRows).mockResolvedValue({ items });
  vi.mocked(client.listPhoiPhieuStk).mockResolvedValue({ items: [] });
  vi.mocked(client.listPhoiPhieuTruckAssignments).mockResolvedValue({ assignments: [], unassignedTrucks: [], accountants: [] });
  vi.mocked(client.getPhoiPhieuReport).mockResolvedValue({ rows: [], grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '', soLuong: 0, phaiThu: 0, phaiTra: 0 } });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhoiPhieuControlPage />
    </QueryClientProvider>,
  );
}

const bodyRows = (container: HTMLElement) =>
  [...container.querySelectorAll('.ppc-board tbody tr')] as HTMLTableRowElement[];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('card 20260929_207 — row selection replaces the checkbox column', () => {
  it('ships no checkbox anywhere in the board', async () => {
    const { container } = renderBoard([row({ tripId: 1 })]);
    await screen.findByText('TRP-1');
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('picks a row on click and unpicks it on a second click', async () => {
    const { container } = renderBoard([row({ tripId: 1, tripCode: 'TRP-1' })]);
    await screen.findByText('TRP-1');
    const [first] = bodyRows(container);

    expect(first).not.toHaveAttribute('data-selected');
    fireEvent.click(within(first).getByText('TRP-1'));
    expect(first).toHaveAttribute('data-selected', 'true');
    expect(first).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(within(first).getByText('TRP-1'));
    expect(first).not.toHaveAttribute('data-selected');
  });

  // A row cell carries buttons. Clicking one must run THAT control and leave
  // the selection alone — otherwise one tap both opens the detail and picks a
  // row for a voucher the accountant never chose.
  it('does not pick the row when the press lands on the row’s own button', async () => {
    const { container } = renderBoard([row({ tripId: 1, tripCode: 'TRP-1' })]);
    await screen.findByText('TRP-1');
    const [first] = bodyRows(container);

    fireEvent.click(within(first).getByRole('button', { name: /Xem chi tiết/ }));
    expect(first).not.toHaveAttribute('data-selected');
  });

  it('leaves a row that cannot be issued inert', async () => {
    const { container } = renderBoard([row({ tripId: 1, tripCode: 'TRP-1', confirmable: false })]);
    await screen.findByText('TRP-1');
    const [first] = bodyRows(container);

    expect(first).toHaveClass('ppc-row--locked');
    expect(first).not.toHaveAttribute('tabindex');
    fireEvent.click(within(first).getByText('TRP-1'));
    expect(first).not.toHaveAttribute('data-selected');
  });

  it('toggles every pickable row from the toolbar button, and only those', async () => {
    const { container } = renderBoard([
      row({ tripId: 1, tripCode: 'TRP-1' }),
      row({ tripId: 2, tripCode: 'TRP-2' }),
      row({ tripId: 3, tripCode: 'TRP-3', confirmable: false }),
    ]);
    await screen.findByText('TRP-1');
    const selectAll = screen.getByRole('button', { name: /Chọn cả trang này/ });
    fireEvent.click(selectAll);

    const rows = bodyRows(container);
    expect(rows[0]).toHaveAttribute('data-selected', 'true');
    expect(rows[1]).toHaveAttribute('data-selected', 'true');
    expect(rows[2]).not.toHaveAttribute('data-selected');
    expect(screen.getByText('Đã chọn 2 dòng')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Bỏ chọn dòng trang này/ }));
    expect(bodyRows(container)[0]).not.toHaveAttribute('data-selected');
  });
});
