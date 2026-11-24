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

// SIL-815 — the classification label (ĐƠN/KẸP/KẾT HỢP/LẺ/LẤY LẺ) rides the
// detail header, resolved exactly like the journey card's tag so the card
// and its detail match 100%.
describe('DriverTripHeader — SIL-815 classification chip', () => {
  it('renders the classification label beside the status pill', () => {
    render(<DriverTripHeader trip={trip('IMPORT')} classificationTag="ĐƠN" onBack={() => {}} />);
    expect(screen.getByTestId('classification-tag').textContent).toBe('ĐƠN');
  });

  it('renders no classification chip when the label is absent', () => {
    render(<DriverTripHeader trip={trip('EXPORT')} classificationTag={null} onBack={() => {}} />);
    expect(screen.queryByTestId('classification-tag')).toBeNull();
  });
});

/* Card 20260926_26 item 4: compressed two-line title block — line 1 = back
 * + mã (Số Bill / Booking, the display key), line 2 = location + status
 * pill. The eyebrow is gone; K10.19 (SIL-946, KB §10.4.2) restored the
 * standalone ROUTE line under the factory name. */
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
      documentNumber: null,
      ...fulfillment,
    },
  } as unknown as DriverTaskDetail);

  it('titles the screen with the carrier document number; location, status pill and customer follow on line 2', () => {
    render(<DriverTripHeader
      trip={codedTrip({ documentNumber: 'BL-2026-001', code: 'SHP-2609-00208', factoryShortName: 'ASKEY', routeSummary: 'Cát Lái → Thuận An' })}
      onBack={() => {}}
    />);
    expect(document.querySelector('.driver-task-header__title')?.textContent).toBe('BL-2026-001');
    // Card 20260926_62 (CHIEF): the header copy button is REMOVED — the
    // orphaned glyph broke the title baseline at 390px. Copy affordances
    // live on the grid rows only.
    expect(screen.queryByRole('button', { name: 'Copy Số Bill / Booking' })).toBeNull();
    expect(document.querySelector('.driver-task-header__location')?.textContent).toBe('ASKEY');
    expect(screen.getByTestId('close-status-chip').textContent).toBe('Đóng');
    expect(screen.getByText('SilverSea')).toBeTruthy();
    // The eyebrow is retired. The ROUTE line is back (K10.19 / SIL-946,
    // KB §10.4.2): "tuyến ngay dưới tên nhà máy" — the QA finding
    // supersedes card _26, which had retired it.
    expect(document.querySelector('.driver-task-header__eyebrow')).toBeNull();
    expect(document.querySelector('.driver-task-header__route')?.textContent).toBe('Cát Lái → Thuận An');
  });

  // Card 20260927_1 (user report): the internal shipmentCode (SHP-YYMM-NNNNN)
  // is an ops key — it must never be the driver's title, not even as a
  // fallback.
  it('never renders the internal SHP- shipment code as the title', () => {
    render(<DriverTripHeader
      trip={codedTrip({ documentNumber: null, code: 'SHP-2609-00208', factoryShortName: 'ASKEY' })}
      onBack={() => {}}
    />);
    expect(document.querySelector('.driver-task-header__title')?.textContent).toBe('ASKEY');
    expect(document.querySelector('.driver-task-header__title')?.textContent).not.toContain('SHP-');
  });

  it('falls back to the factory title and hides the duplicating location when no document number exists', () => {
    render(<DriverTripHeader trip={codedTrip({ factoryShortName: 'ASKEY', factoryName: 'Nhà máy Askey' })} onBack={() => {}} />);
    expect(document.querySelector('.driver-task-header__title')?.textContent).toBe('ASKEY');
    expect(document.querySelector('.driver-task-header__location')).toBeNull();
  });

  it('falls back to the route as title, location hidden, without factory or code', () => {
    render(<DriverTripHeader trip={codedTrip({})} onBack={() => {}} />);
    expect(document.querySelector('.driver-task-header__title')?.textContent).toBe('Cảng Cát Lái → Nhà máy Bình Dương');
    expect(document.querySelector('.driver-task-header__location')).toBeNull();
    // The route already IS the title — the route line never repeats it.
    expect(document.querySelector('.driver-task-header__route')).toBeNull();
  });

  // K10.19 (SIL-946): a factory-less record shows the route as the location
  // line — the dedicated route line would repeat it, so it stays hidden.
  it('keeps the route line hidden when the route already rides the location line', () => {
    render(<DriverTripHeader trip={codedTrip({ factoryShortName: null, factoryName: null, routeSummary: 'Cát Lái → Thuận An' })} onBack={() => {}} />);
    expect(document.querySelector('.driver-task-header__title')?.textContent).toBe('Cát Lái → Thuận An');
    expect(document.querySelector('.driver-task-header__route')).toBeNull();
  });
});
