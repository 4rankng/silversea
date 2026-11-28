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
  createPhoiPhieuVoucher: vi.fn(),
  correctPhoiPhieuRow: vi.fn(),
  updatePhoiPhieuRowAmounts: vi.fn(),
}));

import PhoiPhieuControlPage from './PhoiPhieuControlPage';
import * as client from '../../api/phoiPhieuClient';
import type { PhoiPhieuRow } from '../../api/phoiPhieuClient';

/**
 * SIL-1085 (K2.71) — "Lập phiếu chi loại khoản chưa xác nhận trong im lặng,
 * không gọi tên khoản thiếu".
 *
 * The QA repro (26/11, staging d568cbae): chuyến 328 + chuyến 6 selected, the
 * button read "Lập phiếu chi (5 khoản)" over EIGHT chi-hộ khoản — the three
 * unconfirmed ones (HD-QA1110-05, INV-4C-111, INV-4C-222) were dropped from
 * the count without a word, their chips looked exactly like the confirmed
 * ones, and pressing the button only asked for a quỹ account.
 *
 * The rule itself is NOT what this ticket changes (only a confirmed khoản may
 * be issued — that was already right). What was missing is the DISCLOSURE:
 * the khoản must be named, on the board and before the phiếu is issued.
 */
interface Chip {
  feeName: string;
  invoiceNumber: string | null;
  confirmed: boolean;
}

const chip = (over: Partial<Chip> & { feeName: string }): Chip => ({
  invoiceNumber: null,
  confirmed: true,
  ...over,
});

/** A board row whose chi-hộ khoản carry the disposition the server sends
 *  (`voucherSources`) — the same rule the counter counts. */
function row(options: { tripId: number; billOrBooking: string | null; chips: Chip[] }): PhoiPhieuRow {
  const sources = options.chips.map((item, index) => ({
    sourceId: options.tripId * 100 + index,
    entryId: options.tripId * 1000 + index,
    sourceKind: 'OPS' as const,
    costType: null,
    feeName: item.feeName,
    invoiceNumber: item.invoiceNumber,
    confirmed: item.confirmed,
    amount: item.confirmed ? 500_000 : 0,
    included: item.confirmed,
    reason: item.confirmed ? null : 'UNCONFIRMED' as const,
  }));
  return {
    tripId: options.tripId,
    tripCode: `CH-${options.tripId}`,
    shipmentId: options.tripId * 10,
    shipmentCode: `SHP-${options.tripId}`,
    billOrBooking: options.billOrBooking,
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
    departureDate: '2026-11-20',
    transportDate: '2026-11-20',
    tripStatus: 'IN_TRANSIT',
    chiHoThu: 0,
    chiHoTra: 0,
    tienDuong: 0,
    eligibleIn: 0,
    eligibleOut: options.chips.filter((item) => item.confirmed).length,
    cusDispatchNotes: [],
    driverNote: null,
    confirmable: true,
    openSources: [],
    chiHoRows: sources.map((source) => ({
      entryId: source.entryId,
      sourceId: source.sourceId,
      version: 1,
      sourceKind: source.sourceKind,
      feeName: source.feeName,
      invoiceNumber: source.invoiceNumber,
      confirmed: source.confirmed,
    })),
    voucherSources: { IN: sources, OUT: sources },
  };
}

/** The QA's two rows: chuyến 328 carries 3 of 4 confirmed, chuyến 6 carries 2
 *  of 4 — five issued, three unconfirmed, eight khoản in all. */
const row328 = row({
  tripId: 328,
  billOrBooking: 'HD-QA1110',
  chips: [
    chip({ feeName: 'Phí nâng', invoiceNumber: 'HD-QA1110-01' }),
    chip({ feeName: 'Phí hạ', invoiceNumber: 'HD-QA1110-02' }),
    chip({ feeName: 'Phí lưu bãi', invoiceNumber: 'HD-QA1110-03' }),
    chip({ feeName: 'Phí kiểm hành', invoiceNumber: 'HD-QA1110-05', confirmed: false }),
  ],
});
const row6 = row({
  tripId: 6,
  billOrBooking: 'INV-4C',
  chips: [
    chip({ feeName: 'Phí bốc xếp', invoiceNumber: 'INV-4C-001' }),
    chip({ feeName: 'Phí bốc xếp', invoiceNumber: 'INV-4C-222' }),
    chip({ feeName: 'Phí dọn container', invoiceNumber: 'INV-4C-111', confirmed: false }),
    chip({ feeName: 'Phí vận hành', invoiceNumber: 'INV-4C-333', confirmed: false }),
  ],
});

function renderBoard(items: PhoiPhieuRow[]) {
  vi.mocked(client.listPhoiPhieuRows).mockResolvedValue({ items });
  vi.mocked(client.listPhoiPhieuStk).mockResolvedValue({ items: [{ id: 5, code: 'ACB', name: 'TK công ty' }] });
  vi.mocked(client.listPhoiPhieuTruckAssignments).mockResolvedValue({ assignments: [], unassignedTrucks: [], accountants: [] });
  vi.mocked(client.getPhoiPhieuReport).mockResolvedValue({ rows: [], grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '', soLuong: 0, phaiThu: 0, phaiTra: 0, partyShortName: null, partyId: null, partyKind: null, isOwnFleet: false } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(
    <QueryClientProvider client={queryClient}>
      <PhoiPhieuControlPage />
    </QueryClientProvider>,
  ), queryClient };
}

const bodyRows = (container: HTMLElement) =>
  [...container.querySelectorAll('.ppc-board tbody tr')] as HTMLTableRowElement[];

const boardAction = (container: HTMLElement, name: string | RegExp) =>
  within(container.querySelector('.ppc-actions') as HTMLElement).getByRole('button', { name });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SIL-1085 (K2.71) — khoản chưa xác nhận được gọi tên, không loại trong im lặng', () => {
  it('labels the unconfirmed khoản on the board chip itself', { timeout: 15000 }, async () => {
    const { container } = renderBoard([row328, row6]);
    await screen.findAllByText('HD-QA1110', undefined, { timeout: 10_000 });
    const [first, second] = bodyRows(container);
    // The badge rides the khoản that is missing its đối chiếu, not the row:
    // the three confirmed chips of chuyến 328 stay clean.
    const lines = [...first.querySelectorAll('.ppc-invoice-line')] as HTMLElement[];
    expect(lines).toHaveLength(4);
    expect(within(lines[0]).queryByText('Chưa xác nhận')).not.toBeInTheDocument();
    expect(within(lines[3]).getByText('Chưa xác nhận')).toBeInTheDocument();
    expect(within(second).getAllByText('Chưa xác nhận')).toHaveLength(2);
    // The badge sits on the chip of the khoản it names.
    expect(within(lines[3]).getByDisplayValue('HD-QA1110-05')).toBeInTheDocument();
  });

  it('says the count means 5 of 8 and how many are dropped for want of đối chiếu', { timeout: 15000 }, async () => {
    const { container } = renderBoard([row328, row6]);
    await screen.findAllByText('HD-QA1110', undefined, { timeout: 10_000 });
    // SIL-1223 — the identity cell (Số Bill / Booking) carries the row's DETAIL
    // trigger now, so a press there opens "Chi tiết tiền đường" instead of
    // picking the row. The row is still the selection control — picked by
    // clicking its body — so the gesture moved to the customer cell. The
    // intent (pick these two rows, then read what the phiếu would issue) is
    // unchanged.
    fireEvent.click(within(bodyRows(container)[0]).getByText('KH A'));
    fireEvent.click(within(bodyRows(container)[1]).getByText('KH A'));
    // The counter itself is unchanged (five khoản sẽ được lập phiếu) …
    expect(boardAction(container, 'Lập phiếu chi (5 khoản)')).toBeEnabled();
    // … and the line beside it says what the 5 means: five of the eight
    // khoản, the three unconfirmed ones named as dropped.
    expect(screen.getByText('5/8 khoản chi hộ sẽ được lập phiếu · 3 khoản chưa xác nhận sẽ bị bỏ qua')).toBeInTheDocument();
  });

  it('lists every khoản — carried and dropped, each by name and reason — before the phiếu is issued', { timeout: 15000 }, async () => {
    const { container } = renderBoard([row328, row6]);
    await screen.findAllByText('HD-QA1110', undefined, { timeout: 10_000 });
    fireEvent.click(within(bodyRows(container)[0]).getByText('KH A'));
    fireEvent.click(within(bodyRows(container)[1]).getByText('KH A'));
    fireEvent.click(boardAction(container, /Lập phiếu chi/));

    const drawer = await screen.findByRole('dialog', { name: /Xem trước lập phiếu chi/ });
    expect(within(drawer).getByText('Sẽ được lập phiếu (5 khoản)')).toBeInTheDocument();
    expect(within(drawer).getByText('Bị loại khỏi phiếu (3 khoản)')).toBeInTheDocument();
    // The carried khoản are named too (fee + số hóa đơn + chuyến).
    expect(within(drawer).getByText('HD-QA1110-01')).toBeInTheDocument();
    expect(within(drawer).getByText('INV-4C-222')).toBeInTheDocument();
    // Every dropped khoản is called by name, with the reason.
    expect(within(drawer).getByText('HD-QA1110-05')).toBeInTheDocument();
    expect(within(drawer).getByText('INV-4C-111')).toBeInTheDocument();
    expect(within(drawer).getByText('INV-4C-333')).toBeInTheDocument();
    expect(within(drawer).getAllByText('chưa xác nhận')).toHaveLength(3);
    // Nothing was issued just by looking.
    expect(client.createPhoiPhieuVoucher).not.toHaveBeenCalled();
  });

  it('issues the phiếu from the preview, for the selected trips only', { timeout: 15000 }, async () => {
    vi.mocked(client.createPhoiPhieuVoucher).mockResolvedValue({
      voucherId: 9, code: 'CP-1', total: 2_500_000, entries: 1,
    });
    const { container } = renderBoard([row328, row6]);
    await screen.findAllByText('HD-QA1110', undefined, { timeout: 10_000 });
    fireEvent.click(within(bodyRows(container)[0]).getByText('KH A'));
    fireEvent.click(within(bodyRows(container)[1]).getByText('KH A'));
    fireEvent.click(boardAction(container, /Lập phiếu chi/));
    const drawer = await screen.findByRole('dialog', { name: /Xem trước lập phiếu chi/ });

    // Without a quỹ account the phiếu stays dark, with the reason.
    const confirm = within(drawer).getByRole('button', { name: 'Xác nhận lập phiếu chi (5)' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('title', 'Chọn số tài khoản quỹ (STK)');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Tài khoản chi (STK)' }));
    fireEvent.click(await screen.findByRole('option', { name: 'ACB - TK công ty' }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(client.createPhoiPhieuVoucher).toHaveBeenCalledWith({
      tripIds: [328, 6],
      direction: 'OUT',
      treasuryAccountId: 5,
    }));
    // The issued phiếu is named on the board and the selection is dropped.
    expect(await screen.findByText(/Đã lập phiếu CP-1: 1 khoản, tổng 2.500.000 ₫/)).toBeInTheDocument();
  });
});
