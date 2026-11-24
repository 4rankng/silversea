// SIL-919 (KB §7.2.1 / CUS-08, audit 24/11 mục 7.1) — trọng lượng hiển thị
// thống nhất theo TẤN trên mọi màn hình. Bảng Kiểm soát phơi phiếu in
// "26.000kg" (đơn vị nhập) thay vì "26 tấn" (đơn vị đọc); chỉ ô NHẬP giữ kg.
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { PhoiPhieuRow } from '../../api/phoiPhieuClient';

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
import { businessDateISO } from '../../lib/format';

function phoiRow(overrides: Partial<PhoiPhieuRow> = {}): PhoiPhieuRow {
  return {
    tripId: 41,
    tripCode: 'TRP-919',
    shipmentId: 9,
    shipmentCode: 'S919',
    billOrBooking: 'BILL-919',
    customerName: 'Khách 919',
    factoryName: null,
    routeName: 'Tuyến 919',
    containerNumber: 'CONT919',
    containerTypeLabel: '40DC',
    cargoWeightKg: 12000,
    containerPayloadKg: 26000,
    liftSite: 'Cảng A',
    dropSite: 'Cảng B',
    plateNumber: '51C-919',
    driverName: 'Lái xe 919',
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
    chiHoRows: [],
    ...overrides,
  };
}

function renderPage(rows: PhoiPhieuRow[]) {
  vi.mocked(client.listPhoiPhieuRows).mockResolvedValue({ items: rows });
  vi.mocked(client.listPhoiPhieuStk).mockResolvedValue({ items: [] });
  vi.mocked(client.listPhoiPhieuTruckAssignments).mockResolvedValue({ assignments: [], unassignedTrucks: [], accountants: [] });
  vi.mocked(client.getPhoiPhieuReport).mockResolvedValue({
    rows: [],
    grand: { party: '', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: '', soLuong: 0, phaiThu: 0, phaiTra: 0, partyShortName: null, partyId: null, partyKind: null },
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhoiPhieuControlPage />
    </QueryClientProvider>,
  );
}

describe('Kiểm soát phơi phiếu — trọng lượng hiển thị theo TẤN (CUS-08)', () => {
  it('prints the container payload in tấn, never in kg', async () => {
    const { container } = renderPage([phoiRow()]);
    await screen.findByText('BILL-919');
    const cell = container.querySelector('td.ppc-col--thongso');
    expect(cell?.textContent).toContain('26 tấn');
    expect(cell?.textContent).not.toContain('kg');
  });
});
