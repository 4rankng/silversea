import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/phoiPhieuClient', () => ({
  listPhoiPhieuRows: vi.fn(),
  listPhoiPhieuStk: vi.fn(),
  listPhoiPhieuTruckAssignments: vi.fn(),
  getPhoiPhieuReport: vi.fn(),
  getPhoiPhieuPartyLots: vi.fn(),
  correctPhoiPhieuRow: vi.fn(),
  updatePhoiPhieuRowAmounts: vi.fn(),
}));

import PhoiPhieuControlPage from './PhoiPhieuControlPage';

/** The report section owns a SECOND date range, so the strip contract looks
 *  inside the one FilterBar region instead of the whole page. */
async function withinFilterBar(screen: typeof import('@testing-library/react').screen) {
  const bar = await screen.findByLabelText('Tìm kiếm');
  const strip = bar.closest('.filter-bar') ?? bar.parentElement!;
  expect(strip).toHaveTextContent('Từ ngày');
}
import * as client from '../../api/phoiPhieuClient';

function renderPage() {
  vi.mocked(client.listPhoiPhieuRows).mockResolvedValue({ items: [] });
  vi.mocked(client.listPhoiPhieuStk).mockResolvedValue({ items: [] });
  vi.mocked(client.listPhoiPhieuTruckAssignments).mockResolvedValue({ assignments: [], unassignedTrucks: [], accountants: [] });
  vi.mocked(client.getPhoiPhieuReport).mockResolvedValue({ rows: [], grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '', soLuong: 0, phaiThu: 0, phaiTra: 0, partyShortName: null, partyId: null, partyKind: null } });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhoiPhieuControlPage />
    </QueryClientProvider>,
  );
}

// Card 20260925_46 (date placeholder unification): /accounting/phoi-phieu was
// the last page driving native <input type=date> (browser-locale 'dd/mm/yyyy')
// while every other audited page ships the shared segmented DD/MM/YYYY field.
// Contract: the page uses ONLY the shared segmented date field.
describe('PhoiPhieuControlPage date filter control contract', () => {
  it('renders the shared segmented date field, never a native date input', async () => {
    const { container } = renderPage();
    await withinFilterBar(screen);
    // Card 191026160000 — the strip's from/to pair AND the report section's
    // own range picker: four segmented fields on the page, no native date input.
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(container.querySelectorAll('[data-date-input]').length).toBe(4);
  });

  // Card 20260927_152: the filter region is the ONE shared strip. The search
  // slot, the shared from/to pair and the voucher action are the bar's own
  // items; the four secondary criteria render inline while the strip still fits
  // two rows (jsdom measures no width, so `inline` is the mode under test).
  it('renders the shared strip with the search slot and the Lập phiếu action', async () => {
    const { container } = renderPage();
    await withinFilterBar(screen);
    const bar = container.querySelector('.list-filter-bar') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(container.querySelector('.date-range-fields')).toBeTruthy();
    expect(within(bar).getByLabelText('Tìm kiếm')).toHaveAttribute('placeholder', 'Bill/Booking, phí, hóa đơn');
    expect(within(bar).getByRole('button', { name: /Lập phiếu/ })).toBeTruthy();
  });

  it('keeps the four secondary criteria and their Vietnamese labels reachable', async () => {
    const { container } = renderPage();
    await withinFilterBar(screen);
    const bar = container.querySelector('.list-filter-bar') as HTMLElement;
    for (const label of ['Trạng thái', 'Sắp xếp', 'Loại phiếu', 'Số tài khoản quỹ (STK)']) {
      expect(within(bar).getByText(label)).toBeTruthy();
    }
  });
});

// Card 20260928_162 — the phơi-phiếu board is the second ruled surface for
// the not-charged reason (ADR 2026-09-28): the reason a not-charged cost line
// must carry is readable HERE, in its own column, with the same content the
// dispatch plan grids show (same shared component) — and it no longer hides
// inside the "Ghi chú vận tải" transport-notes cell.
describe('PhoiPhieuControlPage — the not-charged reason column (card 20260928_162)', () => {
  const reasonRow = {
    tripId: 41,
    tripCode: 'TRP-162',
    shipmentId: 9,
    shipmentCode: 'S162',
    billOrBooking: 'BILL-162',
    customerName: 'Khách 162',
    routeName: 'Tuyến 162',
    containerNumber: 'CONT162',
    containerTypeLabel: '40DC',
    cargoWeightKg: 12000,
    containerPayloadKg: 26000,
    liftSite: 'Cảng A',
    dropSite: 'Cảng B',
    plateNumber: '51C-162',
    driverName: 'Lái xe 162',
    departureDate: '2026-09-28',
    tripStatus: 'IN_TRANSIT',
    chiHoThu: 0,
    chiHoTra: 500000,
    tienDuong: null,
    eligibleIn: 0,
    eligibleOut: 1,
    cusDispatchNotes: ['Giao giờ hành chính'],
    opsRecoveryNotes: ['Đã bao gồm trong đơn giá trọn gói', 'Thu khách: Phí lưu bãi'],
    driverNote: null,
    confirmable: true,
    openSources: [],
  };

  function renderPageWithRow(row: typeof reasonRow) {
    vi.mocked(client.listPhoiPhieuRows).mockResolvedValue({ items: [row] });
    vi.mocked(client.listPhoiPhieuStk).mockResolvedValue({ items: [] });
    vi.mocked(client.listPhoiPhieuTruckAssignments).mockResolvedValue({ assignments: [], unassignedTrucks: [], accountants: [] });
    vi.mocked(client.getPhoiPhieuReport).mockResolvedValue({ rows: [], grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '', soLuong: 0, phaiThu: 0, phaiTra: 0, partyShortName: null, partyId: null, partyKind: null } });
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PhoiPhieuControlPage />
      </QueryClientProvider>,
    );
  }

  it('renders the reason in its own OPS cost column, not inside the transport-notes cell', async () => {
    renderPageWithRow(reasonRow);
    const opsCell = await screen.findByText(/Đã bao gồm trong đơn giá trọn gói/);
    expect(opsCell.closest('td')?.className).toContain('ppc-col--ghichu-ops');
    // The whole family rides the same cell — the charged fee name too.
    expect(opsCell.closest('td')).toHaveTextContent('Thu khách: Phí lưu bãi');
    // The transport-notes cell keeps its own content and nothing of the OPS family.
    const transportCell = screen.getByText(/Giao giờ hành chính/).closest('td');
    expect(transportCell?.className).toContain('ppc-col--ghichu');
    expect(transportCell?.className).not.toContain('ghichu-ops');
    expect(transportCell).not.toHaveTextContent('Đã bao gồm trong đơn giá trọn gói');
  });

  it('names the empty column slot with the house dash when the lot has no OPS note', async () => {
    const { container } = renderPageWithRow({ ...reasonRow, opsRecoveryNotes: [] });
    await screen.findByText(/BILL-162/);
    const opsCells = container.querySelectorAll('td.ppc-col--ghichu-ops');
    expect(opsCells).toHaveLength(1);
    expect(opsCells[0]!.textContent).toBe('—');
  });
});

// SIL-974 (K10.54 §10.8.6) — mục "Ngoài chốt" chỉ đọc dưới bảng Kiểm soát
// phơi phiếu: các chuyến chưa gắn đầu việc vận chuyển trong cùng cửa sổ,
// hiển thị để đối soát; ẩn hoàn toàn khi mảng rỗng.
// CR-011 §10.7.1 — TIỀN ĐƯỜNG shows the approved value plus a red
// 'Chờ duyệt: X đ (n)' line when unconfirmed driver road money exists, and
// the quick chip 'Có chi phí chờ duyệt' narrows the board to those rows.
describe('PhoiPhieuControlPage — pending road money line + quick chip (CR-011)', () => {
  function pendingRow(overrides: Record<string, unknown> = {}) {
    return {
      tripId: 51,
      tripCode: 'TRP-51',
      shipmentId: 15,
      shipmentCode: 'S51',
      billOrBooking: 'BILL-51',
      customerName: 'Khách 51',
      routeName: 'Tuyến 51',
      containerNumber: 'CONT51',
      containerTypeLabel: '40DC',
      cargoWeightKg: 12000,
      containerPayloadKg: 26000,
      liftSite: 'Cảng A',
      dropSite: 'Cảng B',
      plateNumber: '51C-051',
      driverName: 'Lái xe 51',
      departureDate: '2026-11-20',
      tripStatus: 'IN_TRANSIT',
      chiHoThu: 0,
      chiHoTra: 0,
      tienDuong: 120000,
      pendingTienDuongAmount: 450000,
      pendingTienDuongCount: 2,
      eligibleIn: 0,
      eligibleOut: 1,
      cusDispatchNotes: [],
      opsRecoveryNotes: [],
      driverNote: null,
      confirmable: true,
      openSources: [],
      ...overrides,
    };
  }

  function renderRows(rows: Array<Record<string, unknown>>) {
    vi.mocked(client.listPhoiPhieuRows).mockResolvedValue({ items: rows as never });
    vi.mocked(client.listPhoiPhieuStk).mockResolvedValue({ items: [] });
    vi.mocked(client.listPhoiPhieuTruckAssignments).mockResolvedValue({ assignments: [], unassignedTrucks: [], accountants: [] });
    vi.mocked(client.getPhoiPhieuReport).mockResolvedValue({ rows: [], grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '', soLuong: 0, phaiThu: 0, phaiTra: 0, partyShortName: null, partyId: null, partyKind: null } });
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PhoiPhieuControlPage />
      </QueryClientProvider>,
    );
  }

  it('renders the red Chờ duyệt line with the pending sum + count under the approved value', async () => {
    renderRows([pendingRow()]);
    await screen.findByText('BILL-51');
    const moneyRow = screen.getByText('BILL-51').closest('tr')!;
    expect(within(moneyRow).getByText(/120\.000/)).toBeInTheDocument();
    expect(within(moneyRow).getByText('Chờ duyệt: 450.000 đ (2)')).toBeInTheDocument();
  });

  it('a row with nothing pending reads only the approved value', async () => {
    renderRows([pendingRow({ pendingTienDuongAmount: 0, pendingTienDuongCount: 0 })]);
    await screen.findByText('BILL-51');
    const moneyRow = screen.getByText('BILL-51').closest('tr')!;
    expect(within(moneyRow).queryByText(/Chờ duyệt:/)).not.toBeInTheDocument();
  });

  it('the quick chip narrows the board to rows holding pending road money and back', async () => {
    renderRows([
      pendingRow(),
      pendingRow({ tripId: 52, billOrBooking: 'BILL-52', plateNumber: '51C-052', pendingTienDuongAmount: 0, pendingTienDuongCount: 0 }),
    ]);
    await screen.findByText('BILL-51');
    expect(screen.getByText('BILL-52')).toBeInTheDocument();
    const chip = screen.getByRole('button', { name: /Có chi phí chờ duyệt \(1\)/ });
    fireEvent.click(chip);
    expect(screen.getByText('BILL-51')).toBeInTheDocument();
    expect(screen.queryByText('BILL-52')).not.toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.getByText('BILL-52')).toBeInTheDocument();
  });
});

describe('PhoiPhieuControlPage — mục Ngoài chốt dưới bảng (SIL-974)', () => {
  const unattachedTrip = {
    tripId: 9001,
    tripCode: 'TRP-202609-0701',
    billOrBooking: 'BL-9001',
    customerName: 'Công ty ABC',
    departureDate: '2026-09-20',
    status: 'CREATED',
    chotIncluded: false as const,
    items: [{
      id: 1, expenseType: 'OTHER', feeName: 'Hải quan giám sát',
      amount: 150000, thuKhach: 200000, note: null, invoiceNumber: 'HD-77',
    }],
    feeTotal: 150000,
  };

  it('renders the read-only Ngoài chốt section without internal TRP-* codes and with Vietnamese status', async () => {
    vi.mocked(client.listPhoiPhieuRows).mockResolvedValueOnce({ items: [], unattachedTrips: [unattachedTrip] });
    renderPage();
    const section = await screen.findByLabelText('Ngoài chốt');
    expect(section.textContent).toContain('BL-9001');
    expect(section.textContent).toContain('Mới tạo');
    expect(section.textContent).not.toContain('TRP-202609-0701');
    expect(section.textContent).not.toContain('CREATED');
    expect(section.textContent).toContain('Chuyến chưa gán đầu việc vận chuyển — chỉ hiển thị, không vào tổng chốt');
  });

  it('hides the section entirely when the window has no unattached trips', async () => {
    vi.mocked(client.listPhoiPhieuRows).mockResolvedValue({ items: [] });
    renderPage();
    await screen.findByLabelText('Tìm kiếm');
    expect(screen.queryByLabelText('Ngoài chốt')).toBeNull();
  });
});
