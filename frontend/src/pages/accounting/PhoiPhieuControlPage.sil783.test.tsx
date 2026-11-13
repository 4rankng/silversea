// SIL-783 (id 906) — bảng phơi phiếu: kế toán sửa Số HĐ từng khoản chi hộ
// NGAY TRÊN BẢNG (kể cả khi chưa nhận phơi) và bấm "+ Chi phí" mở form khai
// chi phí phát sinh mà không cần sang màn khác. Lưu xong số liệu phải ở lại
// sau khi bảng tải lại (refetch).
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

// Stub drawer — the test asserts the board OPENS it for the right trip, not
// the drawer's own internals (they have their own suite).
vi.mock('../../features/expense-accounting/ExpenseCreateDrawer', () => ({
  ExpenseCreateDrawer: ({ work }: { work: { tripId: number } }) => (
    <div data-testid="expense-drawer" data-trip={work.tripId} />
  ),
}));

// The "+ Chi phí" drawer mounts only once the expense catalog loads — stub
// it with an empty catalog (shape per ExpenseAccountingCatalog).
vi.mock('../../api/expenseAccountingClient', () => ({
  expenseAccountingClient: {
    catalog: vi.fn().mockResolvedValue({
      staff: [], accounts: [], accountants: [], opsUsers: [], advances: [],
      suppliers: [], carriers: [], expenseTypes: [],
    }),
  },
}));

import PhoiPhieuControlPage from './PhoiPhieuControlPage';
import { PHOI_INVOICE_EDIT_REASON } from '../../features/accounting/PhoiPhieuInvoiceCell';
import { businessDateISO } from '../../lib/format';

function phoiRow(overrides: Partial<PhoiPhieuRow> = {}): PhoiPhieuRow {
  return {
    tripId: 41,
    tripCode: 'TRP-783',
    shipmentId: 9,
    shipmentCode: 'S783',
    billOrBooking: 'BILL-783',
    customerName: 'Khách 783',
    factoryName: null,
    routeName: 'Tuyến 783',
    containerNumber: 'CONT783',
    containerTypeLabel: '40DC',
    cargoWeightKg: 12000,
    containerPayloadKg: 26000,
    liftSite: 'Cảng A',
    dropSite: 'Cảng B',
    plateNumber: '51C-783',
    driverName: 'Lái xe 783',
    carrierName: null,
    carrierSupplierId: null,
    departureDate: businessDateISO(),
    transportDate: businessDateISO(),
    tripStatus: 'COMPLETED',
    phoiTakenDate: null,
    phoiTakeStatus: null,
    chiHoThu: 500000,
    chiHoTra: 300000,
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
    chiHoRows: [
      { entryId: 11, sourceId: 21, version: 3, feeName: 'Phí nâng', invoiceNumber: 'HD-001', confirmed: false },
    ],
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

describe('PhoiPhieuControlPage — inline Số HĐ trên bảng (SIL-783)', () => {
  it('hiện cột Số HĐ với ô nhập sẵn số hóa đơn của khoản chi hộ', async () => {
    renderWithRows([phoiRow()]);
    const input = await screen.findByRole('textbox', { name: /Số hóa đơn Phí nâng BILL-783/ });
    expect(input).toHaveValue('HD-001');
  });

  it('lưu số hóa đơn sửa trên bảng qua route update khi khoản chưa đối chiếu', async () => {
    renderWithRows([phoiRow()]);
    const input = await screen.findByRole('textbox', { name: /Số hóa đơn Phí nâng BILL-783/ });
    fireEvent.change(input, { target: { value: 'HD-999' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(updatePhoiPhieuRowAmounts).toHaveBeenCalledWith(41, 11, {
        expectedVersion: 3,
        reason: PHOI_INVOICE_EDIT_REASON,
        invoiceNumber: 'HD-999',
      }, { kind: 'OPS' });
    });
    expect(correctPhoiPhieuRow).not.toHaveBeenCalled();
  });

  it('dùng route correct cho khoản ĐÃ đối chiếu (cùng phép tách với dialog chi tiết)', async () => {
    renderWithRows([phoiRow({
      chiHoRows: [{ entryId: 12, sourceId: 22, version: 7, feeName: 'Phí hạ', invoiceNumber: 'HD-OLD', confirmed: true }],
    })]);
    const input = await screen.findByRole('textbox', { name: /Số hóa đơn Phí hạ BILL-783/ });
    fireEvent.change(input, { target: { value: 'HD-NEW' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(correctPhoiPhieuRow).toHaveBeenCalledWith(12, {
        expectedVersion: 7,
        reason: PHOI_INVOICE_EDIT_REASON,
        invoiceNumber: 'HD-NEW',
      }, { kind: 'OPS' });
    });
    expect(updatePhoiPhieuRowAmounts).not.toHaveBeenCalled();
  });

  it('xóa trắng ô nhập lưu số hóa đơn về null', async () => {
    renderWithRows([phoiRow()]);
    const input = await screen.findByRole('textbox', { name: /Số hóa đơn Phí nâng BILL-783/ });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(updatePhoiPhieuRowAmounts).toHaveBeenCalledWith(41, 11, {
        expectedVersion: 3,
        reason: PHOI_INVOICE_EDIT_REASON,
        invoiceNumber: null,
      }, { kind: 'OPS' });
    });
  });

  it('không gọi API khi blur mà không sửa gì', async () => {
    renderWithRows([phoiRow()]);
    const input = await screen.findByRole('textbox', { name: /Số hóa đơn Phí nâng BILL-783/ });
    fireEvent.blur(input);
    expect(updatePhoiPhieuRowAmounts).not.toHaveBeenCalled();
    expect(correctPhoiPhieuRow).not.toHaveBeenCalled();
  });

  it('số liệu sửa ở lại sau khi bảng tải lại (refetch trả giá trị mới, ô nhập đồng bộ)', async () => {
    listPhoiPhieuRows.mockResolvedValueOnce({ items: [phoiRow()] });
    renderWithRows([]);
    let saved: PhoiPhieuRow | null = null;
    // After the save's invalidate, the refetch returns the PERSISTED row —
    // the truth the input must resync to.
    listPhoiPhieuRows.mockImplementation(async () => ({ items: [saved ?? phoiRow()] }));
    updatePhoiPhieuRowAmounts.mockImplementation(async (_tripId: number, _entryId: number, body: { invoiceNumber: string | null }) => {
      saved = phoiRow();
      saved.chiHoRows = [{ entryId: 11, sourceId: 21, version: 4, feeName: 'Phí nâng', invoiceNumber: body.invoiceNumber, confirmed: false }];
      return {};
    });
    const input = await screen.findByRole('textbox', { name: /Số hóa đơn Phí nâng BILL-783/ });
    fireEvent.change(input, { target: { value: 'HD-KEEP' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect((screen.getByRole('textbox', { name: /Số hóa đơn Phí nâng BILL-783/ }) as HTMLInputElement).value).toBe('HD-KEEP');
    });
    expect(updatePhoiPhieuRowAmounts).toHaveBeenCalledTimes(1);
  });
});

describe('PhoiPhieuControlPage — "+ Chi phí" ngay trên bảng (SIL-783)', () => {
  it('mở form khai chi phí phát sinh cho đúng chuyến', async () => {
    renderWithRows([phoiRow()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm chi phí phát sinh BILL-783' }));
    const drawer = await screen.findByTestId('expense-drawer');
    expect(drawer.getAttribute('data-trip')).toBe('41');
  });

  it('dòng không có khoản chi hộ vẫn hiện "—" và nút + Chi phí', async () => {
    renderWithRows([phoiRow({ chiHoRows: [] })]);
    await screen.findByText('BILL-783');
    expect(screen.getByRole('button', { name: 'Thêm chi phí phát sinh BILL-783' })).toBeTruthy();
  });
});
