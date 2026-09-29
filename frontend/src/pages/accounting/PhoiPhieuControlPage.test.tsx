import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/phoiPhieuClient', () => ({
  listPhoiPhieuRows: vi.fn(),
  listPhoiPhieuStk: vi.fn(),
  listPhoiPhieuTruckAssignments: vi.fn(),
  getPhoiPhieuReport: vi.fn(),
}));

import PhoiPhieuControlPage from './PhoiPhieuControlPage';
import * as client from '../../api/phoiPhieuClient';

function renderPage() {
  vi.mocked(client.listPhoiPhieuRows).mockResolvedValue({ items: [] });
  vi.mocked(client.listPhoiPhieuStk).mockResolvedValue({ items: [] });
  vi.mocked(client.listPhoiPhieuTruckAssignments).mockResolvedValue({ assignments: [], unassignedTrucks: [], accountants: [] });
  vi.mocked(client.getPhoiPhieuReport).mockResolvedValue({ rows: [], grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '', soLuong: 0, phaiThu: 0, phaiTra: 0 } });
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
    await screen.findByText('Từ ngày');
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(container.querySelectorAll('[data-date-input]').length).toBe(2);
  });

  // Card 20260927_152: the filter region is the ONE shared strip. The search
  // slot, the shared from/to pair and the voucher action are the bar's own
  // items; the four secondary criteria render inline while the strip still fits
  // two rows (jsdom measures no width, so `inline` is the mode under test).
  it('renders the shared strip with the search slot and the Lập phiếu action', async () => {
    const { container } = renderPage();
    await screen.findByText('Từ ngày');
    const bar = container.querySelector('.list-filter-bar') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(container.querySelector('.date-range-fields')).toBeTruthy();
    expect(within(bar).getByLabelText('Tìm kiếm')).toHaveAttribute('placeholder', 'Mã chuyến, container, khách');
    expect(within(bar).getByRole('button', { name: /Lập phiếu/ })).toBeTruthy();
  });

  it('keeps the four secondary criteria and their Vietnamese labels reachable', async () => {
    const { container } = renderPage();
    await screen.findByText('Từ ngày');
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
    vi.mocked(client.getPhoiPhieuReport).mockResolvedValue({ rows: [], grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '', soLuong: 0, phaiThu: 0, phaiTra: 0 } });
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
    await screen.findByText(/TRP-162/);
    const opsCells = container.querySelectorAll('td.ppc-col--ghichu-ops');
    expect(opsCells).toHaveLength(1);
    expect(opsCells[0]!.textContent).toBe('—');
  });
});