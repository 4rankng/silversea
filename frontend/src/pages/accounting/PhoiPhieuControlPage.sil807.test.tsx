// Ticket 18/11 Task 3.1 (supersedes the SIL-807 UAT 12/11 pin "mọi khoản chi
// của lô đều hiện") — bảng phơi phiếu renders EXACTLY the set the server's
// nguồn rule leaves in `chiHoRows`: RULE enforcement lives in
// phoi-phieu-control.service.ts (isDispatchIntakeLot — a direct-signed lot's
// Ops-declared nâng/hạ rows leave the board; a dispatch-intake lot keeps
// them). The board never re-adds an excluded kind, and each RENDERED khoản
// keeps its own Số-HĐ editor committing on the right mutation route
// (DRIVER → entries/:kind via update, TRIP/OPS → correct/update per state).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhoiPhieuRow } from '../../api/phoiPhieuClient';

const {
  listPhoiPhieuRows, listPhoiPhieuStk, listPhoiPhieuTruckAssignments,
  getPhoiPhieuReport, getPhoiPhieuPartyLots, correctPhoiPhieuRow, updatePhoiPhieuRowAmounts,
} = vi.hoisted(() => ({
  listPhoiPhieuRows: vi.fn(),
  listPhoiPhieuStk: vi.fn(),
  listPhoiPhieuTruckAssignments: vi.fn(),
  getPhoiPhieuReport: vi.fn(),
  getPhoiPhieuPartyLots: vi.fn(),
  correctPhoiPhieuRow: vi.fn(),
  updatePhoiPhieuRowAmounts: vi.fn(),
}));

vi.mock('../../api/phoiPhieuClient', () => ({
  listPhoiPhieuRows: (...args: unknown[]) => listPhoiPhieuRows(...args),
  listPhoiPhieuStk: (...args: unknown[]) => listPhoiPhieuStk(...args),
  listPhoiPhieuTruckAssignments: (...args: unknown[]) => listPhoiPhieuTruckAssignments(...args),
  getPhoiPhieuReport: (...args: unknown[]) => getPhoiPhieuReport(...args),
  getPhoiPhieuPartyLots: (...args: unknown[]) => getPhoiPhieuPartyLots(...args),
  correctPhoiPhieuRow: (...args: unknown[]) => correctPhoiPhieuRow(...args),
  updatePhoiPhieuRowAmounts: (...args: unknown[]) => updatePhoiPhieuRowAmounts(...args),
}));

vi.mock('../../features/expense-accounting/ExpenseCreateDrawer', () => ({
  ExpenseCreateDrawer: ({ work }: { work: { tripId: number } }) => (
    <div data-testid="expense-drawer" data-trip={work.tripId} />
  ),
}));

vi.mock('../../api/expenseAccountingClient', () => ({
  expenseAccountingClient: {
    catalog: vi.fn().mockResolvedValue({
      staff: [], accounts: [], accountants: [], opsUsers: [], advances: [],
      suppliers: [], carriers: [], expenseTypes: [],
    }),
  },
}));

import PhoiPhieuControlPage from './PhoiPhieuControlPage';
import { businessDateISO } from '../../lib/format';

function phoiRow(overrides: Partial<PhoiPhieuRow> = {}): PhoiPhieuRow {
  return {
    tripId: 41,
    tripCode: 'TRP-807',
    shipmentId: 9,
    shipmentCode: 'S807',
    billOrBooking: 'YMJAI226573788',
    customerName: 'Khách 807',
    factoryName: null,
    routeName: 'Tuyến 807',
    containerNumber: 'CONT807',
    containerTypeLabel: '40DC',
    cargoWeightKg: 12000,
    containerPayloadKg: 26000,
    liftSite: 'Cảng A',
    dropSite: 'Cảng B',
    plateNumber: '51C-807',
    driverName: 'Lái xe 807',
    carrierName: null,
    carrierSupplierId: null,
    departureDate: businessDateISO(),
    transportDate: businessDateISO(),
    tripStatus: 'COMPLETED',
    phoiTakenDate: null,
    phoiTakeStatus: null,
    chiHoThu: 0,
    chiHoTra: 0,
    chiHoTripThu: null,
    chiHoTripTra: null,
    tienDuong: null,
    eligibleIn: 0,
    eligibleOut: 0,
    cusDispatchNotes: [],
    opsRecoveryNotes: [],
    driverNote: null,
    ghiChu: null,
    confirmable: true,
    openSources: [],
    chiHoRows: [],
    ...overrides,
  };
}

function renderWithRows(rows: PhoiPhieuRow[]) {
  listPhoiPhieuRows.mockResolvedValue({ items: rows });
  listPhoiPhieuStk.mockResolvedValue({ items: [] });
  listPhoiPhieuTruckAssignments.mockResolvedValue({ assignments: [], unassignedTrucks: [], accountants: [] });
  getPhoiPhieuReport.mockResolvedValue({ rows: [], grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '', soLuong: 0, phaiThu: 0, phaiTra: 0, partyShortName: null, partyId: null, partyKind: null } });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhoiPhieuControlPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listPhoiPhieuRows.mockReset();
  correctPhoiPhieuRow.mockReset().mockResolvedValue({});
  updatePhoiPhieuRowAmounts.mockReset().mockResolvedValue({});
});

describe('PhoiPhieuControlPage — nguồn rule renders the server-filtered chi phí set (ticket 18/11 Task 3.1)', () => {
  it('hiện ô Số HĐ cho khoản LÁI XE khai với nhãn loại phí khi feeName trống, commit đúng route DRIVER', async () => {
    renderWithRows([phoiRow({
      chiHoRows: [
        { entryId: 71, sourceId: 91, version: 2, sourceKind: 'DRIVER', costType: 'FUEL', feeName: null, invoiceNumber: null, confirmed: false },
      ],
    })]);
    // Driver costType label — the fee line never reads blank.
    const input = await screen.findByLabelText('Số hóa đơn Tiền dầu YMJAI226573788');
    fireEvent.change(input, { target: { value: 'HD-FUEL-9' } });
    fireEvent.blur(input);
    await waitFor(() => expect(updatePhoiPhieuRowAmounts).toHaveBeenCalledTimes(1));
    expect(updatePhoiPhieuRowAmounts).toHaveBeenCalledWith(
      41, 71,
      { expectedVersion: 2, reason: expect.any(String), invoiceNumber: 'HD-FUEL-9' },
      { kind: 'DRIVER' },
    );
  });

  it('hiện ô Số HĐ cho khoản chi phí CHUYẾN (TRIP) và commit đúng route TRIP', async () => {
    renderWithRows([phoiRow({
      chiHoRows: [
        { entryId: 81, sourceId: 92, version: 5, sourceKind: 'TRIP', feeName: 'Phí câp container', invoiceNumber: 'HD-TRIP-1', confirmed: true },
      ],
    })]);
    const input = await screen.findByLabelText('Số hóa đơn Phí câp container YMJAI226573788');
    expect(input).toHaveValue('HD-TRIP-1');
    fireEvent.change(input, { target: { value: 'HD-TRIP-2' } });
    // jsdom fires no blur on a never-focused element — focus it first so the
    // Enter handler's blur() reaches the auto-save.
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(correctPhoiPhieuRow).toHaveBeenCalledTimes(1));
    expect(correctPhoiPhieuRow).toHaveBeenCalledWith(
      81,
      { expectedVersion: 5, reason: expect.any(String), invoiceNumber: 'HD-TRIP-2' },
      { kind: 'TRIP' },
    );
  });

  it('lô ĐIỀU VẬN nhập (sản lượng vận tải ngoài) giữ khoản Ops nâng/hạ: chiHoRows còn Phí nâng → ô Số HĐ hiện', async () => {
    // The server kept the OPS nâng row because the lot's creator is a
    // DISPATCHER (isDispatchIntakeLot) — the board renders it like any kind.
    renderWithRows([phoiRow({
      chiHoRows: [
        { entryId: 11, sourceId: 21, version: 3, sourceKind: 'OPS', feeName: 'Phí nâng', invoiceNumber: null, confirmed: false },
        { entryId: 71, sourceId: 91, version: 2, sourceKind: 'DRIVER', costType: 'TOLL', feeName: null, invoiceNumber: null, confirmed: false },
        { entryId: 81, sourceId: 92, version: 5, sourceKind: 'TRIP', feeName: 'Phí vệ sinh', invoiceNumber: null, confirmed: false },
      ],
    })]);
    expect(await screen.findByLabelText('Số hóa đơn Phí nâng YMJAI226573788')).toBeInTheDocument();
    expect(screen.getByLabelText('Số hóa đơn Phí cầu đường YMJAI226573788')).toBeInTheDocument();
    expect(screen.getByLabelText('Số hóa đơn Phí vệ sinh YMJAI226573788')).toBeInTheDocument();
  });

  it('lô khách Silver Sea ký trực tiếp: nâng/hạ đã bị nguồn rule loại ở server — bảng KHÔNG tự sinh lại ô Phí nâng', async () => {
    // The payload is what the rule leaves for a direct-signed lot: DRIVER +
    // TRIP only. The board must render that set verbatim — no Ops nâng/hạ
    // editor may reappear client-side, while the kept kinds stay editable.
    // The composed Ghi chú column sits right after Trạng thái (Task 3.1e) —
    // and with a note on the lot it prints that note (auto-hide only while empty).
    const { container } = renderWithRows([phoiRow({
      ghiChu: 'CUS: giao giờ hành chính; ĐV: trả cont tại Bãi Cát Lái',
      chiHoRows: [
        { entryId: 71, sourceId: 91, version: 2, sourceKind: 'DRIVER', costType: 'TOLL', feeName: null, invoiceNumber: null, confirmed: false },
        { entryId: 81, sourceId: 92, version: 5, sourceKind: 'TRIP', feeName: 'Phí vệ sinh', invoiceNumber: null, confirmed: false },
      ],
    })]);
    await screen.findByLabelText('Số hóa đơn Phí cầu đường YMJAI226573788');
    expect(screen.getByLabelText('Số hóa đơn Phí vệ sinh YMJAI226573788')).toBeInTheDocument();
    expect(screen.queryByLabelText('Số hóa đơn Phí nâng YMJAI226573788')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Số hóa đơn Phí hạ YMJAI226573788')).not.toBeInTheDocument();
    // The duplicate Chi hộ column is gone (Task 3.1d); the Chi-tiết-chi-hộ
    // affordance now rides the Số-HĐ cell.
    expect(screen.queryByRole('columnheader', { name: 'Chi hộ (thu / trả)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chi tiết chi hộ YMJAI226573788' })).toBeInTheDocument();
    const headers = [...container.querySelectorAll('.ppc-board thead th')].map((th) => th.textContent);
    expect(headers.indexOf('Ghi chú')).toBe(headers.indexOf('Trạng thái') + 1);
    expect(screen.getByText('CUS: giao giờ hành chính; ĐV: trả cont tại Bãi Cát Lái')).toBeInTheDocument();
  });
});
