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
