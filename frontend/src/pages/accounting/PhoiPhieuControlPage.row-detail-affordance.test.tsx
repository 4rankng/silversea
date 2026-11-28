import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/phoiPhieuClient', () => ({
  listPhoiPhieuRows: vi.fn(),
  listPhoiPhieuStk: vi.fn(),
  listPhoiPhieuTruckAssignments: vi.fn(),
  getPhoiPhieuReport: vi.fn(),
  getPhoiPhieuPartyLots: vi.fn(),
  assignPhoiPhieuTruckAccountant: vi.fn(),
  assignPhoiPhieuTruckAccountantsBatch: vi.fn(),
  createPhoiPhieuVoucher: vi.fn(),
  correctPhoiPhieuRow: vi.fn(),
  updatePhoiPhieuRowAmounts: vi.fn(),
  updatePhoiPhieuMeta: vi.fn(),
  // SIL-1223 — the identity trigger opens the SAME "Chi tiết tiền đường"
  // dialog the Tiền đường column opens, so the dialog's own read endpoint is
  // part of this board's contract.
  getPhoiPhieuTienDuong: vi.fn(),
  getPhoiPhieuChiHo: vi.fn(),
  confirmPhoiPhieuTienDuong: vi.fn(),
  voidPhoiPhieuRow: vi.fn(),
}));

import PhoiPhieuControlPage from './PhoiPhieuControlPage';
import * as client from '../../api/phoiPhieuClient';
import type { PhoiPhieuRow } from '../../api/phoiPhieuClient';

/** SIL-1223 — the board had no discoverable "open the detail of this row"
 *  affordance: only a small [Xem chi tiết] button in the Tiền đường column
 *  reached the "Chi tiết tiền đường" modal.
 *
 *  The row body is the SELECTION control (card 20260929_207 — the checkbox
 *  column is gone app-wide, a row is picked by clicking it), and a click on an
 *  interactive child runs THAT control and never toggles the row. So the
 *  detail trigger belongs in a CELL: the identity cell (Số Bill / Booking),
 *  the same house precedent as CustomersPage (open moved to the name) and
 *  ExpenseRegisterRows (.expense-register-open in the identity cell).
 *
 *  These cases pin the three ways that can go wrong: the trigger opens the
 *  WRONG row's dialog, the trigger hijacks the row's selection, or the row
 *  body stops toggling the selection. */

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
  containerPayloadKg: 26500,
  liftSite: 'Lạch Huyện',
  dropSite: 'Cát Hải',
  plateNumber: '60C-1',
  driverName: 'Tài xế A',
  departureDate: '2026-09-29',
  transportDate: '2026-09-29',
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
  vi.mocked(client.getPhoiPhieuReport).mockResolvedValue({ rows: [], grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '', soLuong: 0, phaiThu: 0, phaiTra: 0, partyShortName: null, partyId: null, partyKind: null, isOwnFleet: false } });
  vi.mocked(client.getPhoiPhieuTienDuong).mockImplementation(async (tripId: number) => ({
    tripId,
    tripCode: null,
    rows: [],
    totals: { total: 0, confirmed: 0 },
    normAllowance: null,
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PhoiPhieuControlPage />
    </QueryClientProvider>,
  );
}

/** The BOARD's own rows — the page also renders the phone card list and the
 *  monthly report below the board, so every query here stays scoped to the
 *  board table. */
async function boardRows(container: HTMLElement, count: number) {
  await waitFor(() => expect(container.querySelectorAll('.ppc-board tbody tr')).toHaveLength(count));
  return [...container.querySelectorAll('.ppc-board tbody tr')] as HTMLTableRowElement[];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SIL-1223 — the identity cell opens the row detail (phơi phiếu board)', () => {
  it('opens the "Chi tiết tiền đường" dialog of THAT row when the bill/booking is clicked', async () => {
    const { container } = renderBoard([
      row({ tripId: 1, billOrBooking: 'BILL-1223-A' }),
      row({ tripId: 2, billOrBooking: 'BILL-1223-B' }),
    ]);
    const rows = await boardRows(container, 2);

    const trigger = within(rows[1]).getByRole('button', { name: 'Xem chi tiết tiền đường BILL-1223-B' });
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết tiền đường' });
    // The dialog belongs to the CLICKED row: it reads that trip and names
    // that bill — never the neighbour's.
    await waitFor(() => expect(client.getPhoiPhieuTienDuong).toHaveBeenCalledWith(2));
    expect(client.getPhoiPhieuTienDuong).not.toHaveBeenCalledWith(1);
    expect(within(dialog).getByText('Chi tiết tiền đường BILL-1223-B')).toBeInTheDocument();
  });

  it('does NOT toggle the row selection — the press runs the trigger, not the row', async () => {
    const { container } = renderBoard([row({ tripId: 1, billOrBooking: 'BILL-1223-A' })]);
    const rows = await boardRows(container, 1);
    const picked = rows[0];
    expect(picked).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(within(picked).getByRole('button', { name: 'Xem chi tiết tiền đường BILL-1223-A' }));
    await screen.findByRole('dialog', { name: 'Chi tiết tiền đường' });

    // Card 20260929_207 — a press that lands on a control never toggles the
    // row: the row stays unpicked while its detail is open.
    expect(picked).not.toHaveAttribute('data-selected');
    expect(picked).toHaveAttribute('aria-selected', 'false');
  });

  it('still toggles the row selection when the ROW BODY is clicked', async () => {
    const { container } = renderBoard([row({ tripId: 1, billOrBooking: 'BILL-1223-A' })]);
    const rows = await boardRows(container, 1);
    const picked = rows[0];

    // The customer cell is plain text — a press there is the row's own pick.
    fireEvent.click(within(picked).getByText('KH A'));
    expect(picked).toHaveAttribute('data-selected', 'true');
    expect(picked).toHaveAttribute('aria-selected', 'true');

    // …and the same press unpicks it again.
    fireEvent.click(within(picked).getByText('KH A'));
    expect(picked).not.toHaveAttribute('data-selected');
    expect(picked).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps a PLAIN cell available as the row pick — the gesture the migrated tests use', async () => {
    const { container } = renderBoard([row({ tripId: 1, billOrBooking: 'BILL-1223-A' })]);
    const rows = await boardRows(container, 1);

    // SIL-1223 — the identity cell is the detail trigger now, so a row is
    // picked by clicking a cell that carries NO control: a press that lands
    // on an interactive child runs THAT control and never picks the row
    // (useTableRowSelection's INTERACTIVE list). The customer cell must stay
    // plain text for that path to work.
    const customer = within(rows[0]).getByText('KH A');
    expect(customer.closest('button, a, input, select, textarea, [role="button"], [role="checkbox"]')).toBeNull();

    fireEvent.click(customer);
    expect(rows[0]).toHaveAttribute('data-selected', 'true');
  });

  it('keeps the Tiền đường column\'s [Xem chi tiết] opening the same dialog for that row', async () => {
    const { container } = renderBoard([
      row({ tripId: 1, billOrBooking: 'BILL-1223-A' }),
      row({ tripId: 2, billOrBooking: 'BILL-1223-B' }),
    ]);
    const rows = await boardRows(container, 2);

    // Exactly ONE button carries the 'Xem chi tiết' name — the identity
    // trigger is named for the detail it opens ('Xem chi tiết tiền đường …').
    expect(within(rows[0]).getAllByRole('button', { name: 'Xem chi tiết' })).toHaveLength(1);
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Xem chi tiết' }));

    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết tiền đường' });
    await waitFor(() => expect(client.getPhoiPhieuTienDuong).toHaveBeenCalledWith(1));
    expect(within(dialog).getByText('Chi tiết tiền đường BILL-1223-A')).toBeInTheDocument();
  });

  it('keeps the no-bill fallback as plain text — no trigger without an identity', async () => {
    const { container } = renderBoard([row({ tripId: 3, billOrBooking: null })]);
    const rows = await boardRows(container, 1);

    const fallback = within(rows[0]).getByText('Chưa có số Bill/Booking');
    expect(fallback.tagName).toBe('TD');
    expect(within(rows[0]).queryByRole('button', { name: /Xem chi tiết tiền đường/ })).toBeNull();
  });

  it('keeps the identity token inside the trigger — the SIL-875 identity law is untouched', async () => {
    const { container } = renderBoard([row({ tripId: 1, billOrBooking: 'BILL-1223-A' })]);
    const rows = await boardRows(container, 1);

    const trigger = within(rows[0]).getByRole('button', { name: 'Xem chi tiết tiền đường BILL-1223-A' });
    expect(trigger.querySelector('.ppc-identity')).toHaveTextContent('BILL-1223-A');
  });

  it('adds no padding and no border to the identity column — the SIL-879 width law holds', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/accounting/PhoiPhieuControlPage.css'), 'utf8');
    const trigger = css.match(/\.ppc-board \.ppc-identity-open\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(trigger).not.toBe('');
    // A trigger that widened the cell would break the 116px identity floor
    // (SIL-875 ladder) — the reset keeps the column's width budget intact.
    expect(trigger).toContain('padding: 0');
    expect(trigger).toContain('border: 0');
    expect(trigger).toContain('font: inherit');
    expect(trigger).not.toMatch(/(?:min-)?height\s*:/);
  });
});
