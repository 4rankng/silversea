import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { qk } from '../../api/keys';

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
  vi.mocked(client.getPhoiPhieuReport).mockResolvedValue({ rows: [], grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '', soLuong: 0, phaiThu: 0, phaiTra: 0 } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(
    <QueryClientProvider client={queryClient}>
      <PhoiPhieuControlPage />
    </QueryClientProvider>,
  ), queryClient };
}

const bodyRows = (container: HTMLElement) =>
  [...container.querySelectorAll('.ppc-board tbody tr')] as HTMLTableRowElement[];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('card 20260929_207 — row selection replaces the checkbox column', () => {
  it('PHOI10 keeps concise disabled direction actions while retaining scope guidance and selected eligible counts', { timeout: 15000 }, async () => {
    const { container } = renderBoard([row({ eligibleIn: 1, eligibleOut: 1 })]);
    await screen.findAllByText('Chưa có số Bill/Booking');
    const noSelection = screen.getByRole('button', { name: 'Lập phiếu chi' });
    expect(noSelection).toBeDisabled();
    expect(noSelection).toHaveAttribute('title', 'Chọn ít nhất một dòng đã đối chiếu để lập phiếu');
    expect(screen.getByText('Bấm vào một dòng để chọn · 1 dòng lập được phiếu trong kết quả')).toBeInTheDocument();
    fireEvent.click(within(bodyRows(container)[0]).getByText('Chưa có số Bill/Booking'));
    expect(screen.getByRole('button', { name: 'Lập phiếu chi (1 khoản)' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn dòng trang này' }));
    expect(noSelection).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Loại phiếu/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Phiếu thu' }));
    expect(screen.getByRole('button', { name: 'Lập phiếu thu' })).toBeDisabled();
    fireEvent.click(within(bodyRows(container)[0]).getByText('Chưa có số Bill/Booking'));
    expect(screen.getByRole('button', { name: 'Lập phiếu thu (1 khoản)' })).toBeEnabled();
    expect(client.createPhoiPhieuVoucher).not.toHaveBeenCalled();
  });
  it('PHOI09 renders a distinct labelled carrier fact and honest missing driver while preserving row selection', async () => {
    const { container } = renderBoard([row({ carrierName: 'Gaya Container Lines', driverName: null })]);
    await screen.findAllByText('Chưa có số Bill/Booking');
    const first = bodyRows(container)[0];
    expect(within(first).getByText('Nhà vận tải: Gaya Container Lines')).toBeInTheDocument();
    expect(within(first).getByText('Lái xe: Chưa có lái xe')).toBeInTheDocument();
    fireEvent.click(within(first).getByText('Chưa có số Bill/Booking'));
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(client.createPhoiPhieuVoucher).not.toHaveBeenCalled();
  });
  it('PHOI06 renders factory separately from the customer and route, with honest missing copy', async () => {
    const { container } = renderBoard([row({ factoryName: 'Nhà máy A' }), row({ tripId: 2, factoryName: null })]);
    await screen.findByText('Nhà máy: Nhà máy A');
    expect(screen.getByRole('columnheader', { name: 'Khách hàng / Nhà máy / Tuyến' })).toBeInTheDocument();
    const cells = bodyRows(container).map(row => within(row).getByText('Khách hàng: KH A').closest('td')!);
    expect(cells[0]).toHaveTextContent('Nhà máy: Nhà máy A');
    expect(cells[0]).toHaveTextContent('Tuyến: Tuyến A');
    expect(cells[1]).toHaveTextContent('Nhà máy: Chưa có nhà máy');
  });

  it('PHOI05 confirmation-scope change clears payment selection and sends the exact read filter', async () => {
    const { container } = renderBoard([row({ tripId: 1 })]);
    await screen.findAllByText('Chưa có số Bill/Booking');
    fireEvent.click(within(bodyRows(container)[0]).getByText('Chưa có số Bill/Booking'));
    expect(screen.getByRole('button', { name: /Lập phiếu chi \(1 khoản\)/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Đối chiếu chi hộ/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Chưa đối chiếu' }));
    await waitFor(() => expect(client.listPhoiPhieuRows).toHaveBeenLastCalledWith(expect.objectContaining({ confirmation: 'UNCONFIRMED' })));
    expect(screen.getByRole('button', { name: /Lập phiếu chi/ })).toBeDisabled();
    expect(client.createPhoiPhieuVoucher).not.toHaveBeenCalled();
  });
  it('PHOI04 displays the schedule date and names missing schedule without departure fallback', async () => {
    const { container } = renderBoard([row({ tripId: 1, transportDate: '2026-10-01' }), row({ tripId: 2, transportDate: null })]);
    await screen.findAllByText('Chưa có số Bill/Booking');
    expect(within(bodyRows(container)[0]).getByText('01/10/2026')).toBeInTheDocument();
    expect(within(bodyRows(container)[0]).queryByText('29/09/2026')).not.toBeInTheDocument();
    expect(within(bodyRows(container)[1]).getByText('Chưa có ngày hẹn')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Ngày hẹn' })).toBeInTheDocument();
  });

  it('ships no checkbox anywhere in the board', async () => {
    const { container } = renderBoard([row({ tripId: 1 })]);
    await screen.findAllByText('Chưa có số Bill/Booking');
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('picks a row on click and unpicks it on a second click', async () => {
    const { container } = renderBoard([row({ tripId: 1, tripCode: 'TRP-1' })]);
    await screen.findAllByText('Chưa có số Bill/Booking');
    const [first] = bodyRows(container);

    expect(first).not.toHaveAttribute('data-selected');
    fireEvent.click(within(first).getByText('Chưa có số Bill/Booking'));
    expect(first).toHaveAttribute('data-selected', 'true');
    expect(first).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(within(first).getByText('Chưa có số Bill/Booking'));
    expect(first).not.toHaveAttribute('data-selected');
  });

  // A row cell carries buttons. Clicking one must run THAT control and leave
  // the selection alone — otherwise one tap both opens the detail and picks a
  // row for a voucher the accountant never chose.
  it('does not pick the row when the press lands on the row’s own button', async () => {
    const { container } = renderBoard([row({ tripId: 1, tripCode: 'TRP-1' })]);
    await screen.findAllByText('Chưa có số Bill/Booking');
    const [first] = bodyRows(container);

    fireEvent.click(within(first).getByRole('button', { name: /Xem chi tiết/ }));
    expect(first).not.toHaveAttribute('data-selected');
  });

  it('leaves a row that cannot be issued inert', async () => {
    const { container } = renderBoard([row({ tripId: 1, tripCode: 'TRP-1', confirmable: false })]);
    await screen.findAllByText('Chưa có số Bill/Booking');
    const [first] = bodyRows(container);

    expect(first).toHaveClass('ppc-row--locked');
    expect(first).not.toHaveAttribute('tabindex');
    fireEvent.click(within(first).getByText('Chưa có số Bill/Booking'));
    expect(first).not.toHaveAttribute('data-selected');
  });

  it('toggles every pickable row from the toolbar button, and only those', async () => {
    const { container } = renderBoard([
      row({ tripId: 1, tripCode: 'TRP-1' }),
      row({ tripId: 2, tripCode: 'TRP-2' }),
      row({ tripId: 3, tripCode: 'TRP-3', confirmable: false }),
    ]);
    await screen.findAllByText('Chưa có số Bill/Booking');
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

  it('PHOI03 clears hidden selection during a filter query and does not resurrect it on return', async () => {
    const { container } = renderBoard([row({ tripId: 1 })]);
    await screen.findAllByText('Chưa có số Bill/Booking');
    fireEvent.click(within(bodyRows(container)[0]).getByText('Chưa có số Bill/Booking'));
    expect(screen.getByRole('button', { name: /Lập phiếu chi \(1 khoản\)/ })).toBeEnabled();
    let resolveFiltered!: (value: { items: PhoiPhieuRow[] }) => void;
    vi.mocked(client.listPhoiPhieuRows).mockReturnValueOnce(new Promise(resolve => { resolveFiltered = resolve; }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm kiếm' }), { target: { value: 'không khớp' } });
    await waitFor(() => expect(resolveFiltered).toBeDefined());
    expect(screen.getByRole('button', { name: /Lập phiếu chi/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Lập phiếu chi/ }));
    expect(client.createPhoiPhieuVoucher).not.toHaveBeenCalled();
    resolveFiltered({ items: [] });
    await waitFor(() => expect(bodyRows(container)).toHaveLength(0));
    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm kiếm' }), { target: { value: '' } });
    await screen.findAllByText('Chưa có số Bill/Booking');
    expect(bodyRows(container)[0]).not.toHaveAttribute('data-selected');
    expect(screen.getByRole('button', { name: /Lập phiếu chi/ })).toBeDisabled();
    expect(client.createPhoiPhieuVoucher).not.toHaveBeenCalled();
  });

  it('PHOI03 excludes a refreshed nonconfirmable row from count, action and payment request', async () => {
    const { container, queryClient } = renderBoard([row({ tripId: 1 })]);
    await screen.findAllByText('Chưa có số Bill/Booking');
    fireEvent.click(within(bodyRows(container)[0]).getByText('Chưa có số Bill/Booking'));
    expect(screen.getByRole('button', { name: /Lập phiếu chi \(1 khoản\)/ })).toBeEnabled();
    vi.mocked(client.listPhoiPhieuRows).mockResolvedValueOnce({ items: [row({ tripId: 1, confirmable: false })] });
    await act(async () => { await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll }); });
    await waitFor(() => expect(bodyRows(container)[0]).toHaveClass('ppc-row--locked'));
    expect(screen.queryByText('Đã chọn 1 dòng')).not.toBeInTheDocument();
    const issue = screen.getByRole('button', { name: /Lập phiếu chi/ });
    expect(issue).toBeDisabled();
    fireEvent.click(issue);
    expect(client.createPhoiPhieuVoucher).not.toHaveBeenCalled();
  });

  it('PHOI03 prevents payment while a selected result refresh has failed', async () => {
    const { container, queryClient } = renderBoard([row({ tripId: 1 })]);
    await screen.findAllByText('Chưa có số Bill/Booking');
    fireEvent.click(within(bodyRows(container)[0]).getByText('Chưa có số Bill/Booking'));
    vi.mocked(client.listPhoiPhieuRows).mockRejectedValueOnce(new Error('Unavailable'));
    await act(async () => { await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll }); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được bảng kiểm soát');
    const issue = screen.getByRole('button', { name: /Lập phiếu chi/ });
    expect(issue).toBeDisabled();
    fireEvent.click(issue);
    expect(client.createPhoiPhieuVoucher).not.toHaveBeenCalled();
  });
});
