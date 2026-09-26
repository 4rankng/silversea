import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DriverTaskDetail } from '../../api/driverClient';
import { DriverTripHeader } from './DriverTripHeader';

// The header Đóng/Trả chip previously collapsed every non-EXPORT
// tradeDirection to "Trả". The DB enum (shipmentTradeDirectionEnum) is closed
// to IMPORT/EXPORT, so that fallback is unreachable-by-data but wrong by
// contract — the shared pill-axis convention renders unknown as '—', never a
// wrong direction label.

const trip = (tradeDirection: string | null) => ({
  id: 55,
  version: 3,
  tripCode: 'TRIP-55',
  status: 'CREATED',
  routeName: 'Cảng Cát Lái → Nhà máy Bình Dương',
  customerName: 'SilverSea',
  notes: null,
  legs: [],
  containers: [],
  tradeDirection,
  fulfillment: null,
} as unknown as DriverTaskDetail);

describe('DriverTripHeader — Đóng/Trả chip', () => {
  it('labels EXPORT as Đóng', () => {
    render(<DriverTripHeader trip={trip('EXPORT')} onBack={() => {}} />);
    expect(screen.getByTestId('close-status-chip').textContent).toBe('Đóng');
  });

  it('labels IMPORT as Trả', () => {
    render(<DriverTripHeader trip={trip('IMPORT')} onBack={() => {}} />);
    expect(screen.getByTestId('close-status-chip').textContent).toBe('Trả');
  });

  it('renders an unknown tradeDirection as the em-dash, never the wrong direction', () => {
    render(<DriverTripHeader trip={trip('SOME_FUTURE_VALUE')} onBack={() => {}} />);
    expect(screen.getByTestId('close-status-chip').textContent).toBe('—');
  });

  it('hides the chip when tradeDirection is null', () => {
    render(<DriverTripHeader trip={trip(null)} onBack={() => {}} />);
    expect(screen.queryByTestId('close-status-chip')).toBeNull();
  });
});

/* Card 20260926_26 item 4: compressed two-line title block — line 1 = back
 * + mã (Số Bill / Booking, the display key), line 2 = location + status
 * pill. The eyebrow and the standalone route line are gone. */
describe('DriverTripHeader — 20260926_26 two-line title block', () => {
  const codedTrip = (fulfillment: Partial<NonNullable<DriverTaskDetail['fulfillment']>>) => ({
    id: 55,
    version: 3,
    tripCode: 'TRIP-55',
    status: 'IN_TRANSIT',
    routeName: 'Cảng Cát Lái → Nhà máy Bình Dương',
    customerName: 'SilverSea',
    notes: null,
    legs: [],
    containers: [],
    tradeDirection: 'EXPORT',
    fulfillment: {
      factoryName: null,
      factoryShortName: null,
      routeSummary: null,
      code: null,
      ...fulfillment,
    },
  } as unknown as DriverTaskDetail);

  it('leads with the bill/booking code; location, status pill and customer follow on line 2', () => {
    render(<DriverTripHeader
      trip={codedTrip({ code: 'BL-2026-001', factoryShortName: 'ASKEY', routeSummary: 'Cát Lái → Thuận An' })}
      onBack={() => {}}
    />);
    expect(document.querySelector('.driver-task-header__title')?.textContent).toBe('BL-2026-001');
    // Card _28 item 9: the display key is copyable.
    expect(screen.getByRole('button', { name: 'Copy Số Bill / Booking' })).toBeTruthy();
    expect(document.querySelector('.driver-task-header__location')?.textContent).toBe('ASKEY');
    expect(screen.getByTestId('close-status-chip').textContent).toBe('Đóng');
    expect(screen.getByText('SilverSea')).toBeTruthy();
    // The eyebrow and the standalone route line are retired.
    expect(document.querySelector('.driver-task-header__eyebrow')).toBeNull();
    expect(document.querySelector('.driver-task-header__route')).toBeNull();
  });

  it('falls back to the factory title and hides the duplicating location when no code exists', () => {
    render(<DriverTripHeader trip={codedTrip({ factoryShortName: 'ASKEY', factoryName: 'Nhà máy Askey' })} onBack={() => {}} />);
    expect(document.querySelector('.driver-task-header__title')?.textContent).toBe('ASKEY');
    expect(document.querySelector('.driver-task-header__location')).toBeNull();
  });

  it('falls back to the route as title, location hidden, without factory or code', () => {
    render(<DriverTripHeader trip={codedTrip({})} onBack={() => {}} />);
    expect(document.querySelector('.driver-task-header__title')?.textContent).toBe('Cảng Cát Lái → Nhà máy Bình Dương');
    expect(document.querySelector('.driver-task-header__location')).toBeNull();
  });
});
