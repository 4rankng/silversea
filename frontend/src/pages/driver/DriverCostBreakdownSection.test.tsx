import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TripStatus } from '@tingting/shared';
import { DriverCostBreakdownSection } from './DriverTaskInfoSections';
import type { DriverTaskDetail } from '../../api/driverClient';

const baseTrip = {
  id: 1,
  version: 1,
  tripCode: 'TRP-2611-0001',
  status: 'COMPLETED',
  departureDate: '2026-11-04',
  routeName: 'Bắc Giang',
  truckPlate: '15H-149.80',
  fuelLiters: null,
  fuelMode: 'AUTO',
  totalRoadAllowance: null,
  driverSalary: '192308',
  hasReturnCargo: false,
  notes: null,
  costSubmissionNote: null,
  accountingLock: null,
  containers: [],
  legs: [],
} as unknown as DriverTaskDetail;

const breakdown = { freight: 3_952_000, tolls: 110_000, salary: 192_308, surcharge: 200_000, fuel: 0, allowance: 0, totalCost: 502_308 };

describe('DriverCostBreakdownSection (wave 7 — SIL-638 TC3-T3)', () => {
  it('renders every economics row with the computed values on a completed trip', () => {
    render(
      <MemoryRouter>
        <DriverCostBreakdownSection trip={{ ...baseTrip, costBreakdown: breakdown }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Chi phí chuyến')).toBeInTheDocument();
    expect(screen.getByText('Cước chuyến')).toBeInTheDocument();
    expect(screen.getByText('Phí cầu đường VETC')).toBeInTheDocument();
    expect(screen.getByText('Lương chuyến')).toBeInTheDocument();
    expect(screen.getByText('Phụ phí Kẹp')).toBeInTheDocument();
    expect(screen.getByText('Chi phí dầu')).toBeInTheDocument();
    expect(screen.getByText('Tiền đường')).toBeInTheDocument();
    expect(screen.getByText('Tổng chi phí')).toBeInTheDocument();
    // The carrying leg's VETC + the wage + the phụ phí read as numbers.
    expect(screen.getByText('110.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('192.308 ₫')).toBeInTheDocument();
    expect(screen.getByText('200.000 ₫')).toBeInTheDocument();
    expect(screen.getByText('3.952.000 ₫')).toBeInTheDocument();
  });

  it('renders the honest 0 lines (no stations, unconfigured phụ phí) instead of hiding rows', () => {
    render(
      <MemoryRouter>
        <DriverCostBreakdownSection trip={{ ...baseTrip, costBreakdown: { ...breakdown, tolls: 0, surcharge: 0, totalCost: 392_308 } }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Phí cầu đường VETC')).toBeInTheDocument();
    expect(screen.getByText('Phụ phí Kẹp')).toBeInTheDocument();
    // 0 ₫ appears at least twice (VETC + phụ phí) — both rows stay visible.
    const zeros = screen.getAllByText('0 ₫');
    expect(zeros.length).toBeGreaterThanOrEqual(2);
  });

  it('r4: a route without stations shows the owner warning next to the 0 ₫, never a silent null', () => {
    render(
      <MemoryRouter>
        <DriverCostBreakdownSection trip={{ ...baseTrip, costBreakdown: { ...breakdown, tolls: 0, tollZeroReason: 'route_chua_cau_hinh_tram' } }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Phí cầu đường VETC')).toBeInTheDocument();
    expect(screen.getByText('0 ₫ · Route chưa cấu hình trạm thu VETC — cần nhập để tính')).toBeInTheDocument();
  });

  it('renders nothing before completion or when the wire carries no breakdown', () => {
    const { container: inTransit } = render(
      <MemoryRouter>
        <DriverCostBreakdownSection trip={{ ...baseTrip, status: TripStatus.IN_TRANSIT, costBreakdown: breakdown }} />
      </MemoryRouter>,
    );
    expect(inTransit).toBeEmptyDOMElement();
    const { container: noData } = render(
      <MemoryRouter>
        <DriverCostBreakdownSection trip={{ ...baseTrip, costBreakdown: null }} />
      </MemoryRouter>,
    );
    expect(noData).toBeEmptyDOMElement();
  });
});
