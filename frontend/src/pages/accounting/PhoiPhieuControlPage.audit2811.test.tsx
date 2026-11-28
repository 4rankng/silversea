// 28/11 staging audit — the board's wait/empty faces and honest counters:
// a loading skeleton while the window fetches, the shared EmptyState card at
// 0 results, and a result counter that names BOTH the rendered rows and the
// phiếu-eligible subset (the old copy read '0 dòng lập được phiếu' while a
// row still rendered). Scoped to those faces.
import { fireEvent, render, screen, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import * as client from '../../api/phoiPhieuClient';
import type { PhoiPhieuRow } from '../../api/phoiPhieuClient';

const row = (over: Partial<PhoiPhieuRow>): PhoiPhieuRow => ({
  tripId: 1,
  tripCode: 'TRP-1',
  shipmentId: 11,
  shipmentCode: 'SHP-1',
  billOrBooking: 'BILL-2811',
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
  departureDate: '2026-11-28',
  transportDate: '2026-11-28',
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

function renderBoard(items: PhoiPhieuRow[]): RenderResult;
function renderBoard(items: Promise<never>): RenderResult;
function renderBoard(items: PhoiPhieuRow[] | Promise<never>) {
  vi.mocked(client.listPhoiPhieuRows).mockImplementation(() =>
    items instanceof Promise ? items : Promise.resolve({ items }));
  vi.mocked(client.listPhoiPhieuStk).mockResolvedValue({ items: [] });
  vi.mocked(client.listPhoiPhieuTruckAssignments).mockResolvedValue({ assignments: [], unassignedTrucks: [], accountants: [] });
  vi.mocked(client.getPhoiPhieuReport).mockResolvedValue({ rows: [], grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '', soLuong: 0, phaiThu: 0, phaiTra: 0, partyShortName: null, partyId: null, partyKind: null, isOwnFleet: false } });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhoiPhieuControlPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PhoiPhieuControlPage — 28/11 audit faces', () => {
  it('shows a loading skeleton while the rows window fetches', () => {
    renderBoard(new Promise<never>(() => { /* never resolves — the pending face */ }));
    expect(document.querySelector('.tt-skeleton-table, [class*="skeleton"]')).toBeTruthy();
    expect(screen.queryByText(/dòng lập được phiếu/)).toBeNull();
  });

  it('shows the shared EmptyState card at 0 results, never a bare table', async () => {
    renderBoard([]);
    const empty = await screen.findByText('Không có dòng kiểm soát phơi phiếu nào');
    expect(empty.closest('[class*="empty"]')).toBeTruthy();
    expect(document.querySelector('.ppc-board')).toBeNull();
  });

  it('a zero-result search shows the filtered-empty face titled "Không có kết quả" with a reset exit', async () => {
    renderBoard([]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm kiếm' }), { target: { value: 'ZZZ-NOPE-9999' } });
    expect(await screen.findByText('Không có kết quả')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xóa bộ lọc' })).toBeInTheDocument();
  });

  it('the counter names the rendered rows AND the phiếu-eligible subset', async () => {
    renderBoard([
      row({ tripId: 1, confirmable: true }),
      row({ tripId: 2, billOrBooking: 'BILL-2812', confirmable: false }),
    ]);
    await screen.findByText('BILL-2811');
    expect(screen.getByText('Bấm vào một dòng để chọn · 2 dòng trong kết quả · 1 dòng lập được phiếu')).toBeInTheDocument();
  });

  it('the GHI CHÚ CHI PHÍ OPS cell clamps through the 2-line wrapper and carries the full note in its title', async () => {
    const { container } = renderBoard([
      row({ tripId: 3, billOrBooking: 'BILL-2813', opsRecoveryNotes: ['Lý do không thu khách A', 'Thu khách: Phí lưu bãi'] }),
    ]);
    await screen.findByText('BILL-2813');
    const clamp = container.querySelector('.ppc-ops-note-clamp') as HTMLElement;
    expect(clamp).toBeTruthy();
    expect(clamp.textContent).toContain('Lý do không thu khách A');
    expect(clamp.getAttribute('title')).toBe('Lý do không thu khách A · Thu khách: Phí lưu bãi');
  });
});
