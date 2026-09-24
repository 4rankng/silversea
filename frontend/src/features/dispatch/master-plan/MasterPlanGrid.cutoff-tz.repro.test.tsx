import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentListItem } from '../../../api/shipmentClient';
import { MasterPlanGrid } from './MasterPlanGrid';
import { MasterPlanFilters } from './MasterPlanFilters';

vi.mock('../../../api/configClient', () => ({
  configClient: { getDispatchZones: vi.fn().mockResolvedValue({ items: [] }) },
}));

// Red repro (exploratory code sweep 2026-09-15): MasterPlanGrid's
// formatDateTime/formatHour render the customs cutoff and the schedule
// hour-line fallback with machine-local getters (getHours / toLocaleDateString
// without a timeZone option), while every sibling formatter pins
// Asia/Ho_Chi_Minh. On any machine not running UTC+7 the cutoff date can flip
// a calendar day and the hour line shows the wrong hour ("0H" for a 22:00 VN
// cutoff on a UTC+8 machine) — the exact class formatCardTimeShort was pinned
// to kill (QA machines run UTC+8).
const originalTz = process.env.TZ;

const item = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000200',
  customerName: 'Công ty ABC',
  routeName: 'LH — Biên Hòa',
  factoryName: 'Nhà máy XYZ',
  blNumber: 'BL-2026-002',
  bookingRef: null,
  shippingLineName: 'Maersk',
  tradeDirection: 'IMPORT',
  pickupLocation: 'Cảng Cát Lái',
  deliveryLocation: 'Kho Bình Dương',
  expectedDeliveryDate: '2026-09-15',
  customsCutoffAt: null,
  operationalNotes: null,
  containerCount20: 1,
  containerCount40: 0,
  containerTypeSummary: '1 x 40HC',
  totalCargoWeightKg: 41000.75,
  allocationStatus: 'NOT_ALLOCATED',
  carrierAllocationSummary: [],
  appointmentGroups: [],
  containerPortGroups: [],
  ...overrides,
} as ShipmentListItem);

describe('MasterPlanGrid — customs cutoff and schedule hour pin Asia/Ho_Chi_Minh', () => {
  beforeEach(() => {
    process.env.TZ = 'Asia/Tokyo'; // UTC+9 — 2h ahead of the business zone
  });

  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it('renders the customs cutoff on the Vietnam calendar date, not the machine date', () => {
    render(<MasterPlanGrid items={[item({ customsCutoffAt: '2026-09-15T22:00:00+07:00' })]} onAllocate={vi.fn()} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/15\/9\/2026|15\/09\/2026/);
    expect(text).not.toMatch(/16\/9?0?[/]2026/);
  });

  it('renders the schedule hour-line fallback in the Vietnam hour, not the machine hour', () => {
    render(<MasterPlanGrid items={[item({ plannedReturnAt: '2026-09-15T22:00:00+07:00' })]} onAllocate={vi.fn()} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('22:00 15/09/2026'); // machine hour would render "07:00"
  });

  it('no longer renders date preset quick actions — the date inputs cover them (filter-bar law §5)', () => {
    render(<MasterPlanFilters filters={{
      q: '', tradeDirection: '', allocationStatus: '',
      deliveryDateFrom: '', deliveryDateTo: '', portIds: [], carrierKeys: [],
    }} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Hôm nay' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hôm sau' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tất cả các ngày' })).toBeNull();
  });
});
