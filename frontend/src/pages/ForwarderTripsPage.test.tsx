import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ShipmentStatus, TripStatus, type ForwarderTripSummary } from '@tingting/shared';
import ForwarderTripsPage from './ForwarderTripsPage';

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

const rows: ForwarderTripSummary[] = [
  {
    id: 41,
    tripCode: 'TRIP-41',
    shipmentId: 14,
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
  },
  {
    id: 42,
    tripCode: 'TRIP-42',
    shipmentId: 15,
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
  },
];

describe('ForwarderTripsPage bill workspace', () => {
  beforeEach(() => {
    useForwarderTripsMock.mockReturnValue({ data: { items: rows, counts: {} }, isLoading: false, error: null });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
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

  it('passes Bill, declaration, container, customer and date filters to the scoped query', () => {
    vi.useFakeTimers();
    render(<ForwarderTripsPage />);
    const search = screen.getByPlaceholderText('Nhập số Bill, Booking, tờ khai, container hoặc khách hàng');
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
