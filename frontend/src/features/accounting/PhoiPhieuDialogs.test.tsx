import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { PhoiPhieuChiHoDialog } from './PhoiPhieuChiHoDialog';
import { PhoiPhieuTienDuongDialog } from './PhoiPhieuTienDuongDialog';
import PhoiPhieuControlPage from '../../pages/accounting/PhoiPhieuControlPage';

vi.mock('../../api/phoiPhieuClient', () => ({
  correctPhoiPhieuRow: vi.fn(),
  getPhoiPhieuChiHo: vi.fn().mockResolvedValue({
    tripCode: 'ST-2609-0001',
    ngayLayPhoi: null,
    trangThaiLay: null,
    rows: [
      {
        entryId: 1, sourceId: 11, feeName: 'Phí nâng hạ', invoiceNumber: null,
        amountThu: 1_350_000, amountTra: 1_350_000, payerName: 'Khách', confirmed: false, version: 3,
      },
    ],
  }),
  getPhoiPhieuTienDuong: vi.fn().mockResolvedValue({
    tripCode: 'ST-2609-0001',
    totals: { total: 2_000_000, confirmed: 500_000 },
    rows: [
      {
        sourceId: 21, version: 1, costType: 'FUEL', feeName: 'Xăng đường',
        occurredAt: '2026-09-22', driverName: 'Tuấn', driverEnteredAmount: 900_000,
        amount: 1_000_000, confirmed: false,
      },
    ],
  }),
  updatePhoiPhieuMeta: vi.fn(),
  updatePhoiPhieuRowAmounts: vi.fn(),
  voidPhoiPhieuRow: vi.fn(),
  // Card 20260923_8 group B — board-row tests render the whole control page,
  // so the shared client mock also covers the page-level read endpoints.
  listPhoiPhieuRows: vi.fn().mockResolvedValue({ items: [
    {
      tripId: 101, tripCode: 'ST-2609-0101', shipmentId: 9001, shipmentCode: 'SHP-9001',
      billOrBooking: 'BILL-001', customerName: 'Khách A', routeName: 'HP - HN',
      containerNumber: 'ABCZ1234567', containerTypeLabel: '40HC', cargoWeightKg: 24000,
      liftSite: 'Đình Vũ', dropSite: 'Bắc Giang', plateNumber: '29K-123.45', driverName: 'Tuấn',
      departureDate: '2026-09-22T00:00:00.000Z', tripStatus: 'IN_TRANSIT',
      chiHoThu: null, chiHoTra: null, tienDuong: null,
      cusDispatchNotes: [], driverNote: null, confirmable: true,
    },
    {
      tripId: 102, tripCode: 'ST-2609-0102', shipmentId: 9002, shipmentCode: 'SHP-9002',
      billOrBooking: 'BILL-002', customerName: 'Khách B', routeName: 'HP - QN',
      containerNumber: 'DEFZ7654321', containerTypeLabel: '20GP', cargoWeightKg: 18000,
      liftSite: 'Đình Vũ', dropSite: 'Quảng Ninh', plateNumber: '29K-678.90', driverName: 'Thắng',
      departureDate: '2026-09-22T00:00:00.000Z', tripStatus: 'COMPLETED',
      chiHoThu: 1_350_000, chiHoTra: 1_350_000, tienDuong: 2_000_000,
      cusDispatchNotes: [], driverNote: null, confirmable: true,
    },
  ] }),
  listPhoiPhieuStk: vi.fn().mockResolvedValue({ items: [] }),
  listPhoiPhieuTruckAssignments: vi.fn().mockResolvedValue({ assignments: [], unassignedTrucks: [], accountants: [] }),
  assignPhoiPhieuTruckAccountant: vi.fn(),
  createPhoiPhieuVoucher: vi.fn(),
  getPhoiPhieuReport: vi.fn().mockResolvedValue({ rows: [], grand: null }),
}));

vi.mock('../../api/expenseAccountingClient', () => ({
  expenseAccountingClient: { catalog: vi.fn().mockResolvedValue({ feeCategories: [], employees: [] }) },
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  document.body.style.overflow = '';
});

describe('phôi phiếu detail dialogs render in the house modal shell (card 20260922_67)', () => {
  it('Chi hộ dialog portals into document.body inside the fixed backdrop — not the page flow', async () => {
    render(<PhoiPhieuChiHoDialog tripId={7} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết chi hộ' });
    // Portal proof: the backdrop div is a DIRECT child of document.body, so
    // the dialog's on-screen position can never inherit the 100+-row board's
    // scroll offset (the 21,588px defect).
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveClass('ops-modal-backdrop');
    await waitFor(() => expect(screen.getByText('Chi tiết chi hộ ST-2609-0001')).toBeInTheDocument());
  });

  it('Chi hộ dialog: ✕ and Escape both dismiss; body scroll locks while open and restores after', async () => {
    const onClose = vi.fn();
    const { unmount } = render(<PhoiPhieuChiHoDialog tripId={7} onClose={onClose} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    await screen.findByRole('dialog', { name: 'Chi tiết chi hộ' });
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Chi tiết chi hộ' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('Chi hộ dialog: focus returns to the opener after unmount', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<PhoiPhieuChiHoDialog tripId={7} onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    await screen.findByRole('dialog', { name: 'Chi tiết chi hộ' });
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('Tiền đường dialog portals into document.body and ✕ dismisses', async () => {
    const onClose = vi.fn();
    render(<PhoiPhieuTienDuongDialog tripId={7} onClose={onClose} onSaved={vi.fn()} />, { wrapper: makeWrapper() });
    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết tiền đường' });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveClass('ops-modal-backdrop');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('both dialog sources import the shared modal stylesheet (card acceptance 3)', () => {
    for (const file of ['PhoiPhieuChiHoDialog.tsx', 'PhoiPhieuTienDuongDialog.tsx']) {
      const source = readFileSync(resolve(process.cwd(), `src/features/accounting/${file}`), 'utf8');
      expect(source).toContain("import '../ops/ops-modal.css';");
      expect(source).toContain('OpsModalBackdrop');
    }
  });
});

// Card 20260923_8 group B — board-row composition of the control page.
// RED-first notes: at HEAD the board renders TWO identical "Xem chi tiết"
// buttons per row, the chi hộ cell has no atomic line structure, and the date
// cell carries no nowrap column class — all three asserts below fail at HEAD.
describe('phôi phiếu board row composition (card 20260923_8 group B)', () => {
  function renderBoard() {
    return render(<PhoiPhieuControlPage />, { wrapper: makeWrapper() });
  }

  async function findRow(tripCode: string) {
    await screen.findByText(tripCode);
    const row = screen.getAllByRole('row').find((candidate) => candidate.textContent?.includes(tripCode));
    expect(row).toBeDefined();
    return row!;
  }

  it('renders exactly ONE "Xem chi tiết" button per row — the two identical buttons are deduped (D1 ruling)', async () => {
    renderBoard();
    for (const tripCode of ['ST-2609-0101', 'ST-2609-0102']) {
      const row = await findRow(tripCode);
      expect(within(row).getAllByRole('button', { name: 'Xem chi tiết' })).toHaveLength(1);
    }
  });

  it('keeps chi hộ detail reachable via a distinct icon-only affordance named "Chi tiết chi hộ" (no workflow orphaned)', async () => {
    renderBoard();
    const row = await findRow('ST-2609-0101');
    const chiHo = within(row).getByRole('button', { name: /Chi tiết chi hộ/ });
    expect(chiHo.textContent.trim()).toBe('');
  });

  it('renders chi hộ phải thu / phải trả as atomic lines (no ragged mid-token wrap)', async () => {
    renderBoard();
    const row = await findRow('ST-2609-0101');
    const lines = within(row).getAllByText((content, element) => element?.classList.contains('ppc-line') ?? false);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(within(row).getByText(/Phải thu:/)).toBeTruthy();
    expect(within(row).getByText(/Phải trả:/)).toBeTruthy();
  });

  it('date cells carry the atomic nowrap column class (no mid-number fracture like 22/09/202 6)', async () => {
    renderBoard();
    await findRow('ST-2609-0102');
    for (const cell of screen.getAllByText('22/09/2026')) {
      expect(cell.closest('td')?.className).toContain('ppc-col--date');
    }
  });
});
