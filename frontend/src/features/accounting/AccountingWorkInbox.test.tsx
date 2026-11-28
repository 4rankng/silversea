import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountingWorkInbox } from './AccountingWorkInbox';
import { getPhoiPhieuPartyLots, getPhoiPhieuReport } from '../../api/phoiPhieuClient';
import type { PhoiPhieuPartyLot, PhoiPhieuReportRow } from '../../api/phoiPhieuClient';

/** K6.42 — 'Công việc kế toán' là ba thẻ Phải thu / Phải trả / Đối chiếu; mỗi
 *  dòng mang [Tạo phiếu thanh toán] (thu tiền khách) và [Tạo phiếu chi] (chi
 *  trả nhà cung cấp), mở ngăn lập phiếu của đúng đối tượng. */

vi.mock('../../api/phoiPhieuClient', () => ({
  getPhoiPhieuReport: vi.fn(),
  getPhoiPhieuPartyLots: vi.fn(),
}));

vi.mock('../../pages/accounting/PhoiPhieuPartyLotsDrawer', () => ({
  PhoiPhieuPartyLotsDrawer: (props: { kind: string; party: string | null }) => (
    <div data-testid="drawer-mock">{`${props.kind}:${props.party ?? 'batch'}`}</div>
  ),
}));

const thuReportRow: PhoiPhieuReportRow = {
  party: 'LONG MINH',
  partyShortName: 'LONG MINH',
  partyId: 1,
  partyKind: 'customer', isOwnFleet: false,
  tienNang: 0,
  tienHa: 500000,
  psKhac: 0,
  tongPhaiThuTra: 500000,
  daThuTra: 0,
  conLai: 500000,
  ghiChu: null,
  soLuong: 2,
  phaiThu: 500000,
  phaiTra: 0,
};

const traReportRow: PhoiPhieuReportRow = {
  ...thuReportRow,
  party: 'NHA XE MINH PHAT',
  partyShortName: 'MINH PHAT',
  partyId: 7,
  partyKind: 'carrier', isOwnFleet: false,
  tongPhaiThuTra: 300000,
  conLai: 300000,
  soLuong: 1,
  phaiThu: 0,
  phaiTra: 300000,
};

const thuLot: PhoiPhieuPartyLot = {
  tripId: 1,
  shipmentId: 8,
  billOrBooking: 'YMJAI226573788',
  containerNumber: 'TGHU1234567',
  departureDate: '2026-11-20',
  tienNang: 0,
  tienHa: 500000,
  psKhac: 0,
  total: 500000,
  daThuTra: 0,
  conLai: 500000,
  party: 'LONG MINH',
  entries: [{ sourceId: 3, expectedVersion: 1, amount: 500000, bucket: 'ha' }],
};

const traLot: PhoiPhieuPartyLot = {
  ...thuLot,
  tienNang: 0,
  tienHa: 300000,
  total: 300000,
  conLai: 300000,
  party: 'NHA XE MINH PHAT',
  entries: [{ sourceId: 4, expectedVersion: 1, amount: 300000, bucket: 'ha' }],
};

const grandRow: PhoiPhieuReportRow = {
  ...thuReportRow,
  party: 'TỔNG',
  partyShortName: null,
  partyId: null,
  partyKind: null, isOwnFleet: false,
  soLuong: 0,
  tongPhaiThuTra: 0,
  conLai: 0,
  phaiThu: 0,
  phaiTra: 0,
};

function mockData(opts: {
  thuRows?: PhoiPhieuReportRow[];
  traRows?: PhoiPhieuReportRow[];
  thuLots?: PhoiPhieuPartyLot[];
  traLots?: PhoiPhieuPartyLot[];
} = {}) {
  vi.mocked(getPhoiPhieuReport).mockImplementation((kind) => Promise.resolve({
    rows: (kind === 'THU' ? opts.thuRows : opts.traRows) ?? [],
    grand: grandRow,
  }));
  vi.mocked(getPhoiPhieuPartyLots).mockImplementation((kind) => Promise.resolve({
    items: (kind === 'THU' ? opts.thuLots : opts.traLots) ?? [],
  }));
}

function renderCards() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AccountingWorkInbox from="2026-11-01" to="2026-11-26" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('K6.42 — ba thẻ Công việc kế toán', () => {
  it('renders the three cards Phải thu / Phải trả / Đối chiếu', async () => {
    mockData();
    renderCards();
    for (const title of ['Phải thu', 'Phải trả', 'Đối chiếu']) {
      expect(await screen.findByRole('region', { name: title }), title).toBeInTheDocument();
    }
    expect(screen.getByText(/Tổng còn phải thu:/)).toBeInTheDocument();
    expect(screen.getByText(/Tổng còn phải trả:/)).toBeInTheDocument();
    expect(screen.getByText(/lô mở cả hai chiều/)).toBeInTheDocument();
  });

  it('every Phải thu row carries both voucher buttons and they open the party drawer', async () => {
    mockData({ thuRows: [thuReportRow] });
    renderCards();
    const lane = await screen.findByRole('region', { name: 'Phải thu' });
    expect(await within(lane).findByText('LONG MINH')).toBeInTheDocument();
    fireEvent.click(within(lane).getByRole('button', { name: 'Tạo phiếu thanh toán' }));
    expect(screen.getByTestId('drawer-mock')).toHaveTextContent('THU:LONG MINH');
    fireEvent.click(within(lane).getByRole('button', { name: 'Tạo phiếu chi' }));
    expect(screen.getByTestId('drawer-mock')).toHaveTextContent('TRA:LONG MINH');
  });

  it('every Phải trả row carries both voucher buttons too', async () => {
    mockData({ traRows: [traReportRow] });
    renderCards();
    const lane = await screen.findByRole('region', { name: 'Phải trả' });
    expect(await within(lane).findByText('MINH PHAT')).toBeInTheDocument();
    fireEvent.click(within(lane).getByRole('button', { name: 'Tạo phiếu thanh toán' }));
    expect(screen.getByTestId('drawer-mock')).toHaveTextContent('THU:NHA XE MINH PHAT');
    fireEvent.click(within(lane).getByRole('button', { name: 'Tạo phiếu chi' }));
    expect(screen.getByTestId('drawer-mock')).toHaveTextContent('TRA:NHA XE MINH PHAT');
  });

  it('Đối chiếu lists the lots open on both sides with per-side voucher buttons', async () => {
    mockData({ thuLots: [thuLot], traLots: [traLot] });
    renderCards();
    const lane = await screen.findByRole('region', { name: 'Đối chiếu' });
    expect(await within(lane).findByText('YMJAI226573788')).toBeInTheDocument();
    expect(within(lane).getByText('LONG MINH')).toBeInTheDocument();
    expect(within(lane).getByText('NHA XE MINH PHAT')).toBeInTheDocument();
    // The receivable button opens the CUSTOMER drawer, the payable one the
    // carrier's — each side of the same lot.
    fireEvent.click(within(lane).getByRole('button', { name: 'Tạo phiếu thanh toán' }));
    expect(screen.getByTestId('drawer-mock')).toHaveTextContent('THU:LONG MINH');
    fireEvent.click(within(lane).getByRole('button', { name: 'Tạo phiếu chi' }));
    expect(screen.getByTestId('drawer-mock')).toHaveTextContent('TRA:NHA XE MINH PHAT');
  });

  it('an empty window renders the compact empty line per card, never fabricated zeros', async () => {
    mockData();
    renderCards();
    expect((await screen.findAllByText('Chưa có khoản nào.')).length).toBe(3);
    expect(screen.queryByRole('button', { name: 'Tạo phiếu thanh toán' })).toBeNull();
  });
});

describe('SIL-1276 — tiêu đề cột cùng chiều với số liệu của nó', () => {
  it('tiêu đề cột tiền mang class "num" như ô số; tiêu đề thao tác mang class record-table__action như ô nút', async () => {
    mockData({ thuRows: [thuReportRow] });
    renderCards();
    const lane = await screen.findByRole('region', { name: 'Phải thu' });
    await within(lane).findByText('LONG MINH');
    // Header cells mirror the data cells' alignment classes: a left-aligned
    // money header over a right-aligned value (QA 28/11 measured exactly
    // that on all three lanes) reads as a column it does not belong to.
    const moneyHead = within(lane).getByRole('columnheader', { name: 'Còn phải thu' });
    expect(moneyHead.className).toContain('num');
    const moneyCell = lane.querySelector('td[data-label="Còn phải thu"]')!;
    expect(moneyCell.className).toContain('num');
    const actionHead = within(lane).getByRole('columnheader', { name: 'Hành động' });
    expect(actionHead.className).toContain('record-table__action');
    const actionCell = within(lane).getByRole('button', { name: 'Tạo phiếu thanh toán' }).closest('td')!;
    expect(actionCell.className).toContain('record-table__action');
  });
});

describe('SIL-1277 — hai nút phiếu cùng kiểu trong ô thao tác', () => {
  it('[Tạo phiếu thanh toán] và [Tạo phiếu chi] mang cùng lớp style — không nút trơn kề nút có viền', async () => {
    mockData({ thuRows: [thuReportRow] });
    renderCards();
    const lane = await screen.findByRole('region', { name: 'Phải thu' });
    await within(lane).findByText('LONG MINH');
    // Parity, not a literal variant name: the contract is "peer actions in
    // one cell look alike" (QA 28/11: one bordered, one ghost = "chữ trơn").
    const thanhToan = within(lane).getByRole('button', { name: 'Tạo phiếu thanh toán' });
    const chi = within(lane).getByRole('button', { name: 'Tạo phiếu chi' });
    expect(chi.className).toBe(thanhToan.className);
    expect(chi.className).toContain('btn--secondary');
  });
});
