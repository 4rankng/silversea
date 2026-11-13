// SIL-807 (UAT KH 12/11) — bảng phơi phiếu: cột Chi phí phát sinh / Số HĐ
// phải hiện TOÀN BỘ khoản chi của lô (kể cả Lái xe khai / chi phí chuyến),
// mỗi khoản một ô sửa Số HĐ auto-save (blur/Enter) theo đúng mutation route
// của kind đó — trước đây chỉ OPS hiện, các lô khác in '—'.
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

describe('PhoiPhieuControlPage — Số HĐ mọi khoản chi của lô (SIL-807)', () => {
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

  it('một lô nhiều kind (OPS + DRIVER + TRIP) hiện đủ 3 ô Số HĐ trong cùng ô cột', async () => {
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
});
