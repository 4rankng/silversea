import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { ShipmentStatus, TripStatus, type ForwarderTripSummary } from '@tingting/shared';
import ForwarderTripsPage from './ForwarderTripsPage';
import { forwarderClient } from '../api/forwarderClient';

const invalidateQueriesMock = vi.fn();
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

const useForwarderTripsMock = vi.fn();

vi.mock('../hooks/useQueries', () => ({
  useForwarderTrips: (...args: unknown[]) => useForwarderTripsMock(...args),
}));

vi.mock('./ForwarderTripDetailPage', () => ({
  ForwarderTripWorkspace: ({ tripId }: { tripId: number }) => {
    const [draft, setDraft] = useState('');
    return <div data-testid="expense-workspace">Chi tiết {tripId}<input aria-label="Nháp chi phí" value={draft} onChange={(event) => setDraft(event.target.value)} /></div>;
  },
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const rows: ForwarderTripSummary[] = [
  {
    workItemKey: 'shipment:14:trip:41',
    id: 41,
    tripId: 41,
    tripCode: 'TRIP-41',
    shipmentId: 14,
    shipmentVersion: 3,
    shipmentCode: 'SHP-14',
    departureDate: '2026-07-30',
    status: TripStatus.IN_TRANSIT,
    tripStatus: TripStatus.IN_TRANSIT,
    shipmentStatus: ShipmentStatus.IN_TRANSIT,
    routeName: 'Hải Phòng — Bắc Ninh',
    truckPlate: '15C-123.45',
    customerName: 'Long Minh',
    customerReference: 'LM-REF-41',
    billNumber: 'DNKM13333',
    bookingNumber: null,
    factoryName: 'NEWEB',
    tradeDirection: 'EXPORT',
    declarationNumbers: '105254544125',
    containerTypeSummary: '2×40HC',
    containerCount: 2,
    containerNumbers: 'MSBU1245657, MSDU1245784',
    cargoTypeName: 'Hàng FCL',
    expenseScopesCompleted: 0,
    expenseScopesTotal: 2,
    statusColor: 'pending',
    orderExchangeStatus: 'COMPLETED',
    orderExchangeStartedAt: '2026-07-29T08:00:00.000Z',
    orderExchangeStartedBy: 7,
    orderExchangeCompletedAt: '2026-07-29T09:00:00.000Z',
    orderExchangeCompletedBy: 7,
  },
  {
    workItemKey: 'shipment:15:trip:42',
    id: 42,
    tripId: 42,
    tripCode: 'TRIP-42',
    shipmentId: 15,
    shipmentVersion: 1,
    shipmentCode: 'SHP-15',
    departureDate: '2026-07-31',
    status: TripStatus.CREATED,
    tripStatus: TripStatus.CREATED,
    shipmentStatus: ShipmentStatus.NEW,
    routeName: 'Hải Phòng — Hà Nội',
    truckPlate: null,
    customerName: 'An Phát',
    customerReference: 'AP-REF-42',
    billNumber: null,
    bookingNumber: 'BOOK-42',
    factoryName: 'Nhà máy AP',
    tradeDirection: 'IMPORT',
    declarationNumbers: null,
    containerTypeSummary: '1×20DC',
    containerCount: 1,
    containerNumbers: 'TGBU3190086',
    cargoTypeName: 'Hàng FCL',
    expenseScopesCompleted: 0,
    expenseScopesTotal: 1,
    statusColor: 'none',
    orderExchangeStatus: 'PENDING',
    orderExchangeStartedAt: null,
    orderExchangeStartedBy: null,
    orderExchangeCompletedAt: null,
    orderExchangeCompletedBy: null,
  },
  {
    workItemKey: 'shipment:16:trip:0',
    id: null,
    tripId: null,
    tripCode: null,
    shipmentId: 16,
    shipmentVersion: 1,
    shipmentCode: 'SHP-16',
    departureDate: '2026-08-01',
    status: null,
    tripStatus: null,
    shipmentStatus: ShipmentStatus.READY_FOR_DISPATCH,
    routeName: 'Hải Phòng — Hải Dương',
    truckPlate: null,
    customerName: 'Minh Hải',
    customerReference: null,
    billNumber: 'PRETRIP-16',
    bookingNumber: null,
    factoryName: 'Nhà máy MH',
    tradeDirection: 'IMPORT',
    declarationNumbers: null,
    containerTypeSummary: '1×40HC',
    containerCount: 1,
    containerNumbers: null,
    cargoTypeName: 'Hàng FCL',
    expenseScopesCompleted: 0,
    expenseScopesTotal: 0,
    statusColor: 'none',
    orderExchangeStatus: 'PENDING',
    orderExchangeStartedAt: null,
    orderExchangeStartedBy: null,
    orderExchangeCompletedAt: null,
    orderExchangeCompletedBy: null,
  },
];

describe('ForwarderTripsPage bill workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useForwarderTripsMock.mockReturnValue({ data: { items: rows, counts: {} }, isLoading: false, error: null });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    window.scrollTo = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('shows and advances đổi lệnh before a trip exists without opening expense controls', async () => {
    vi.spyOn(forwarderClient, 'startOrderExchange').mockResolvedValue({ version: 2 });
    render(<ForwarderTripsPage />);
    fireEvent.click(screen.getAllByText('PRETRIP-16')[0]);
    expect(screen.getByText('Có thể đổi lệnh ngay; chưa cần chờ điều vận phân xe.')).toBeTruthy();
    expect(screen.getByText('Chưa có chuyến xe. Phần kê khai chi phí sẽ mở sau khi điều vận phân xe.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu đổi lệnh' }));
    await vi.waitFor(() => expect(forwarderClient.startOrderExchange).toHaveBeenCalledWith(16, 1));
  });

  it('renders the requested persisted bill columns and selects a bill for expense detail', () => {
    render(<ForwarderTripsPage />);

    expect(screen.getAllByText('Ngày vận chuyển').length).toBeGreaterThan(0);
    expect(screen.getByText('Số tờ khai')).toBeTruthy();
    expect(screen.getAllByText('DNKM13333').length).toBeGreaterThan(0);
    expect(screen.getAllByText('105254544125').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2×40HC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Chờ bổ sung ngày').length).toBeGreaterThan(0);
    expect(screen.getByTestId('expense-workspace').textContent).toContain('Chi tiết 41');

    fireEvent.change(screen.getByLabelText('Nháp chi phí'), { target: { value: 'Dữ liệu Bill A' } });
    fireEvent.click(screen.getAllByText('BOOK-42')[0]);
    expect(screen.getByTestId('expense-workspace').textContent).toContain('Chi tiết 42');
    expect((screen.getByLabelText('Nháp chi phí') as HTMLInputElement).value).toBe('');
  });

  it('uses a focused list-to-detail flow on phone and restores focus to the selected Bill', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    const { container } = render(<ForwarderTripsPage />);

    expect(container.querySelector('.ops-bill-page')?.classList.contains('is-mobile-detail-open')).toBe(false);
    const mobileList = container.querySelector('.ops-bill-mobile-list');
    expect(mobileList).toBeTruthy();
    const mobileBill = within(mobileList as HTMLElement).getByRole('button', { name: /DNKM13333/ });
    fireEvent.click(mobileBill);
    expect(container.querySelector('.ops-bill-page')?.classList.contains('is-mobile-detail-open')).toBe(true);
    const backButton = screen.getByRole('button', { name: 'Danh sách lệnh' });
    await waitFor(() => expect(document.activeElement).toBe(backButton));

    fireEvent.click(backButton);
    expect(container.querySelector('.ops-bill-page')?.classList.contains('is-mobile-detail-open')).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(mobileBill));
  });

  it('passes Bill, declaration, container, customer and date filters to the scoped query', () => {
    vi.useFakeTimers();
    render(<ForwarderTripsPage />);
    const search = screen.getByPlaceholderText('Tìm Bill, Booking hoặc tờ khai...');
    fireEvent.change(search, { target: { value: 'DNKM13333' } });
    expect((search as HTMLInputElement).value).toBe('DNKM13333');
    act(() => vi.advanceTimersByTime(350));
    expect(useForwarderTripsMock).toHaveBeenLastCalledWith(undefined, {
      search: 'DNKM13333',
      dateFrom: undefined,
      dateTo: undefined,
    });
    vi.useRealTimers();
  });
});
