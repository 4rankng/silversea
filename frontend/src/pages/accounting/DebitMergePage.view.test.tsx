/**
 * SIL-876 (hotfix CR-009.1) — the QA-visible view law on /accounting/ghep-bo-debit:
 * mặc định mới nhất lên đầu (trang 1 là lô gần hiện tại, không phải lô tháng 9),
 * ô tìm kiếm Bill/Cont/KH trả kết quả đúng, lọc Từ ngày–Đến ngày trả kết quả
 * đúng. The CUS surface (/shipments-debit) runs the SAME helper — the unit
 * laws live in debit-merge-view.test.ts; here we pin the PAGE wiring.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebitMergeItem } from '@tingting/shared';

const { listMergeBoard, getBootstrap } = vi.hoisted(() => ({
  listMergeBoard: vi.fn(),
  getBootstrap: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 9, role: 'ACCOUNTANT' } }),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listSettlementRounds: vi.fn().mockResolvedValue({ items: [] }),
  createSettlementRound: vi.fn(),
  getDebitNoteRoundPreview: vi.fn(),
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));
vi.mock('../../api/shipmentDebit', () => ({
  listDebitMergeBoard: listMergeBoard,
  debitMergeKeys: {
    all: ['accounting-debit-merge'] as const,
    board: (team: boolean) => ['accounting-debit-merge', 'board', team] as const,
  },
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
  lockShipmentCost: vi.fn(),
  unlockShipmentCost: vi.fn(),
  listPendingShipmentCostAdjustRequests: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));

import DebitMergePage from './DebitMergePage';
import { businessDateISO } from '../../lib/format';
import { calendarMonthRange } from '../../hooks/usePeriodRange';

// SIL-1295 — the board opens on the work-period window: fixtures ride the
// window's month so the suite stays green in any month (the seeded filter
// drops out-of-window rows now), and '2000-01-01' is the always-outside date.
const vnToday = businessDateISO();
const periodWindow = calendarMonthRange(Number(vnToday.slice(0, 4)), Number(vnToday.slice(5, 7)));
const dayIn = (dd: string) => `${periodWindow.from.slice(0, 7)}-${dd}`;
const isoToDdMmYyyy = (iso: string) => iso.split('-').reverse().join('/');

const row = (over: Partial<DebitMergeItem> & Pick<DebitMergeItem, 'shipmentId'>): DebitMergeItem => ({
  code: null,
  customerId: 11,
  customerName: 'Long Minh',
  factoryName: null,
  routeName: null,
  deliveryDate: dayIn('10'),
  billOrBookNumber: null,
  creatorName: null,
  creatorCode: null,
  containers: [],
  revenue: { cuoc: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: null },
  chiHo: { csht: [], lift: [], drop: [], other: [] },
  noInvoice: { gnFee: null, gnPaid: null, psFee: null, psPaid: null, fees: [] },
  control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null },
  ...over,
});

import { ToastProvider } from '../../components/shared/Toast';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/ghep-bo-debit']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <DebitMergePage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const bodyBills = () => [...document.querySelectorAll('tbody td[data-col="lot"]')].map((cell) => cell.textContent);

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  getBootstrap.mockResolvedValue({ customers: [], trucks: [] });
  // Tháng 9 chiếm đầu bảng là đúng cái QA fail — DESC phải lôi tháng 11 lên.
  listMergeBoard.mockResolvedValue({
    items: [
      row({ shipmentId: 1, billOrBookNumber: 'BL-SEP-OLD', deliveryDate: '2000-01-01' }),
      row({ shipmentId: 2, billOrBookNumber: 'JJCTCHPDY260305', deliveryDate: dayIn('02'), containers: [{ id: 1, containerNumber: 'TWCU8170772', containerType: null }] }),
      row({ shipmentId: 3, billOrBookNumber: 'BL-NOV-LATEST', deliveryDate: dayIn('18') }),
    ],
    total: 3,
  });
});

describe('DebitMergePage — SIL-876 sort DESC + tìm kiếm + lọc ngày', () => {
  it('mặc định mới nhất lên đầu trong kỳ: lô cũ ngoài kỳ làm việc bị lọc khỏi bảng', async () => {
    renderPage();
    await screen.findByText('BL-NOV-LATEST');
    expect(bodyBills()).toEqual(['BL-NOV-LATEST', 'JJCTCHPDY260305']);
    // SIL-1295 — the seeded window filters out-of-window rows at load.
    expect(bodyBills()).not.toContain('BL-SEP-OLD');
  });

  it('ô tìm kiếm lọc đúng theo số Bill và số container', async () => {
    renderPage();
    await screen.findByText('BL-NOV-LATEST');
    const search = screen.getByLabelText('Tìm lô theo số Bill, container hoặc khách hàng');
    fireEvent.change(search, { target: { value: 'jjctchpdy' } });
    expect(bodyBills()).toEqual(['JJCTCHPDY260305']);
    fireEvent.change(search, { target: { value: 'twcu8170772' } });
    expect(bodyBills()).toEqual(['JJCTCHPDY260305']);
    fireEvent.change(search, { target: { value: '' } });
    expect(bodyBills()).toHaveLength(2);
  });

  it('lọc Từ ngày–Đến ngày giới hạn cột Ngày', async () => {
    renderPage();
    await screen.findByText('BL-NOV-LATEST');
    // The shared DD/MM/YYYY buffered fields emit complete ISO dates.
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: isoToDdMmYyyy(dayIn('01')) } });
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: isoToDdMmYyyy(periodWindow.to) } });
    expect(bodyBills()).toEqual(['BL-NOV-LATEST', 'JJCTCHPDY260305']);
  });
});

// SIL-974 (K10.54 §10.8.6) — mục "Ngoài chốt" chỉ đọc dưới Bảng 2.3: hiển
// thị đúng các chuyến chưa gắn đầu việc vận chuyển của các lô ĐANG HIỂN THỊ,
// kèm dòng tổng tiền bị loại; ẩn hoàn toàn khi không có dòng nào.
describe('DebitMergePage — mục Ngoài chốt dưới Bảng 2.3 (SIL-974)', () => {
  const unattachedTrip = {
    tripId: 9001,
    tripCode: 'TRIP-26-0701',
    billOrBooking: 'BL-26-0701',
    customerName: null,
    departureDate: '2026-09-20',
    status: 'CREATED',
    chotIncluded: false as const,
    items: [{
      id: 1, expenseType: 'OTHER', feeName: 'Hải quan giám sát',
      amount: 150000, thuKhach: 200000, note: null, invoiceNumber: 'HD-77',
    }],
    feeTotal: 150000,
  };

  it('hiển thị mục Ngoài chốt + tổng loại trừ cho các chuyến ngoài chốt của lô đang hiển thị', async () => {
    listMergeBoard.mockResolvedValue({
      items: [
        row({ shipmentId: 1, billOrBookNumber: 'BL-ONE', unattachedTrips: [unattachedTrip] }),
        row({ shipmentId: 2, billOrBookNumber: 'BL-TWO' }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findByText('BL-ONE');
    const section = document.querySelector('.debit-merge-unattached') as HTMLElement;
    expect(section).toBeTruthy();
    expect(within(section).getByText('Tổng tiền bị loại khỏi chốt: 150.000')).toBeTruthy();
    // The section rides the ONE shared unattached-trips table (card 20260924_3):
    // business keys, fees, and the per-trip chốt label — display-only caption.
    expect(within(section).getByText('Chuyến chưa gán đầu việc vận chuyển — chỉ hiển thị, không vào tổng chốt')).toBeTruthy();
    // CR-011 §10.6.8: the row names itself by Bill/Booking — the internal
    // trip code never renders.
    expect(within(section).getAllByText('BL-26-0701').length).toBeGreaterThan(0);
    expect(section.textContent).not.toContain('TRIP-26-0701');
    // Heading "Ngoài chốt" + the per-trip Chốt cell read the same label.
    expect(within(section).getAllByText('Ngoài chốt').length).toBeGreaterThanOrEqual(2);
  });

  it('ẩn hoàn toàn khi không lô nào có chuyến ngoài chốt', async () => {
    renderPage();
    await screen.findByText('BL-NOV-LATEST');
    expect(document.querySelector('.debit-merge-unattached')).toBeNull();
  });

  it('tổng loại trừ không bịa 0 khi các chuyến chưa có phí (Chưa xác định)', async () => {
    listMergeBoard.mockResolvedValue({
      items: [row({
        shipmentId: 1,
        billOrBookNumber: 'BL-ONE',
        unattachedTrips: [{ ...unattachedTrip, items: [], feeTotal: null }],
      })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-ONE');
    const section = document.querySelector('.debit-merge-unattached') as HTMLElement;
    expect(within(section).getByText('Tổng tiền bị loại khỏi chốt: Chưa xác định')).toBeTruthy();
  });
});
