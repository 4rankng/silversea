// SIL-763 (id 884) — Cảnh báo đỏ "Phơi chưa được nhận" tại bảng Kiểm soát phơi
// phiếu: chuyến vận chuyển (hôm nay − ngày vận chuyển) ≥ 4 ngày mà kế toán
// chưa tích "Đã nhận phơi" → cột Ghi chú vận tải tự hiện chữ đỏ. Chuyến ≤ 3
// ngày và chuyến đã tích nhận phơi không bao giờ cảnh báo.
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/phoiPhieuClient', () => ({
  listPhoiPhieuRows: vi.fn(),
  listPhoiPhieuStk: vi.fn(),
  listPhoiPhieuTruckAssignments: vi.fn(),
  getPhoiPhieuReport: vi.fn(),
  getPhoiPhieuPartyLots: vi.fn(),
}));

import PhoiPhieuControlPage, {
  PHOI_NOT_RECEIVED_LABEL,
  phoiNotReceivedMessage,
  phoiNotReceivedOverdueDays,
  phoiNotReceivedWarning,
} from './PhoiPhieuControlPage';
import { businessDateISO, businessDateOffsetISO } from '../../lib/format';
import * as client from '../../api/phoiPhieuClient';

const today = businessDateISO();

interface PhoiWarningRowFixture {
  tripId: number;
  tripCode: string;
  shipmentId: number;
  shipmentCode: string;
  billOrBooking: string;
  customerName: string;
  routeName: string;
  containerNumber: string;
  containerTypeLabel: string;
  cargoWeightKg: number;
  containerPayloadKg: number;
  liftSite: string;
  dropSite: string;
  plateNumber: string;
  driverName: string;
  departureDate: string;
  transportDate: string | null;
  phoiTakenDate: string | null;
  tripStatus: string;
  chiHoThu: number;
  chiHoTra: number;
  tienDuong: null;
  eligibleIn: number;
  eligibleOut: number;
  cusDispatchNotes: string[];
  driverNote: null;
  confirmable: boolean;
  openSources: Array<never>;
}

function phoiRow(overrides: Partial<Pick<PhoiWarningRowFixture, 'transportDate' | 'phoiTakenDate' | 'cusDispatchNotes'>> = {}): PhoiWarningRowFixture {
  return {
    tripId: 41,
    tripCode: 'TRP-763',
    shipmentId: 9,
    shipmentCode: 'S763',
    billOrBooking: 'BILL-763',
    customerName: 'Khách 763',
    routeName: 'Tuyến 763',
    containerNumber: 'CONT763',
    containerTypeLabel: '40DC',
    cargoWeightKg: 12000,
    containerPayloadKg: 26000,
    liftSite: 'Cảng A',
    dropSite: 'Cảng B',
    plateNumber: '51C-763',
    driverName: 'Lái xe 763',
    departureDate: today,
    transportDate: today,
    phoiTakenDate: null,
    tripStatus: 'COMPLETED',
    chiHoThu: 0,
    chiHoTra: 0,
    tienDuong: null,
    eligibleIn: 0,
    eligibleOut: 0,
    cusDispatchNotes: [],
    driverNote: null,
    confirmable: true,
    openSources: [],
    ...overrides,
  };
}

function renderWithRow(row: PhoiWarningRowFixture) {
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

beforeEach(() => {
  vi.mocked(client.listPhoiPhieuRows).mockReset();
});

describe('phoiNotReceivedWarning — the 4-day law (SIL-763)', () => {
  it('warns from the 4th transport day onward', () => {
    expect(phoiNotReceivedWarning({ transportDate: businessDateOffsetISO(-4), phoiTakenDate: null }, today)).toBe(true);
    expect(phoiNotReceivedWarning({ transportDate: businessDateOffsetISO(-10), phoiTakenDate: null }, today)).toBe(true);
  });

  it('never warns inside the 3-day window', () => {
    expect(phoiNotReceivedWarning({ transportDate: businessDateOffsetISO(-3), phoiTakenDate: null }, today)).toBe(false);
    expect(phoiNotReceivedWarning({ transportDate: businessDateOffsetISO(0), phoiTakenDate: null }, today)).toBe(false);
  });

  it('a ticked POD date suppresses the warning however old the trip is', () => {
    expect(phoiNotReceivedWarning({ transportDate: businessDateOffsetISO(-9), phoiTakenDate: businessDateOffsetISO(-2) }, today)).toBe(false);
  });

  it('an unparsable or missing transport day never warns', () => {
    expect(phoiNotReceivedWarning({ transportDate: null, phoiTakenDate: null }, today)).toBe(false);
    expect(phoiNotReceivedWarning({ transportDate: 'not-a-date', phoiTakenDate: null }, today)).toBe(false);
  });
});

// SIL-783 (id 906) — the warning carries the overdue AGE: "Quá hạn X ngày"
// with X = transport day → today in calendar days.
describe('phoiNotReceivedOverdueDays / phoiNotReceivedMessage — the day count (SIL-783)', () => {
  it('returns the calendar-day gap from the 4th day onward', () => {
    expect(phoiNotReceivedOverdueDays({ transportDate: businessDateOffsetISO(-4), phoiTakenDate: null }, today)).toBe(4);
    expect(phoiNotReceivedOverdueDays({ transportDate: businessDateOffsetISO(-10), phoiTakenDate: null }, today)).toBe(10);
  });

  it('is null inside the 3-day window, with a POD tick, or without a parsable day', () => {
    expect(phoiNotReceivedOverdueDays({ transportDate: businessDateOffsetISO(-3), phoiTakenDate: null }, today)).toBeNull();
    expect(phoiNotReceivedOverdueDays({ transportDate: businessDateOffsetISO(-9), phoiTakenDate: businessDateOffsetISO(-2) }, today)).toBeNull();
    expect(phoiNotReceivedOverdueDays({ transportDate: null, phoiTakenDate: null }, today)).toBeNull();
    expect(phoiNotReceivedOverdueDays({ transportDate: 'not-a-date', phoiTakenDate: null }, today)).toBeNull();
  });

  it('builds the spec Task 3.3.1 message with the real gap', () => {
    expect(phoiNotReceivedMessage({ transportDate: businessDateOffsetISO(-5), phoiTakenDate: null }, today))
      .toBe(`⚠️ ${PHOI_NOT_RECEIVED_LABEL} (Quá hạn 5 ngày)`);
    expect(phoiNotReceivedMessage({ transportDate: businessDateOffsetISO(-2), phoiTakenDate: null }, today)).toBeNull();
  });
});

describe('PhoiPhieuControlPage — the red Phơi chưa được nhận note (SIL-763 + SIL-783)', () => {
  it('paints the overdue trip’s transport-notes cell red with the day-count warning', async () => {
    renderWithRow(phoiRow({ transportDate: businessDateOffsetISO(-5) }));
    const warning = await screen.findByText(`⚠️ ${PHOI_NOT_RECEIVED_LABEL} (Quá hạn 5 ngày)`);
    const cell = warning.closest('td');
    expect(cell?.className).toContain('ppc-col--ghichu');
    expect(warning).toHaveClass('ppc-phoi-overdue');
    // Empty notes keep their house '—' below the warning line.
    expect(cell?.textContent).toContain('—');
  });

  it('keeps the transport notes visible under the warning line', async () => {
    renderWithRow(phoiRow({ transportDate: businessDateOffsetISO(-6), cusDispatchNotes: ['Giao giờ hành chính'] }));
    await screen.findByText(`⚠️ ${PHOI_NOT_RECEIVED_LABEL} (Quá hạn 6 ngày)`);
    expect(screen.getByText('Giao giờ hành chính')).toBeInTheDocument();
  });

  it('shows no warning for a trip inside the 3-day window', async () => {
    renderWithRow(phoiRow({ transportDate: businessDateOffsetISO(-2) }));
    await screen.findByText('BILL-763');
    expect(screen.queryByText(PHOI_NOT_RECEIVED_LABEL)).toBeNull();
  });

  it('shows no warning once the POD date is ticked, however old the trip is', async () => {
    renderWithRow(phoiRow({ transportDate: businessDateOffsetISO(-9), phoiTakenDate: businessDateOffsetISO(-2) }));
    await screen.findByText('BILL-763');
    expect(screen.queryByText(PHOI_NOT_RECEIVED_LABEL)).toBeNull();
  });
});
