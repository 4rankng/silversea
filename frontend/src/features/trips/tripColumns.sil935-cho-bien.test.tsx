// SIL-935 (KB §7.2.1 K7.20) — bảng chuyến (/trips) names the external-carrier
// awaiting-plate state: the XE cell (desktop table) and the <640px mobile
// card render the 'Chờ biển' chip beside the dash instead of a silent '—'.
// Internal-fleet trips keep the exact prior cell shapes.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TripStatus, type TripDetail } from '@tingting/shared';
import { buildTripColumns } from './tripColumns';
import { TripMobileCard } from './TripMobileCard';

function mkExternalTrip(plate: string | null): TripDetail {
  return {
    id: 573,
    tripCode: 'TRP-202611-0573',
    status: TripStatus.CREATED,
    carrierType: 'EXTERNAL',
    externalPlateNumber: plate,
    customer: { id: 1, name: 'Long Minh' },
    route: { id: 6, name: 'KCN Quế Võ → ASKEY' },
    containers: [],
    legs: [],
  } as unknown as TripDetail;
}

function mkOwnTrip(): TripDetail {
  return {
    id: 574,
    tripCode: 'TRP-202611-0574',
    status: TripStatus.CREATED,
    carrierType: 'OWN',
    truck: { id: 12, licensePlate: '29H-111.11' },
    customer: { id: 1, name: 'Long Minh' },
    route: { id: 6, name: 'KCN Quế Võ → ASKEY' },
    containers: [],
    legs: [],
  } as unknown as TripDetail;
}

const truckColumn = buildTripColumns(70).find((column) => column.id === 'truck')!;
// TanStack's cell renderer generic is unexpressible at this call shape; the
// named alias documents the exact ctx the table hands the column.
const renderTruckCellFn = truckColumn.cell as (ctx: { row: { original: TripDetail } }) => React.ReactNode;

function renderTruckCell(trip: TripDetail) {
  return render(
    <table>
      <tbody>
        <tr>
          {renderTruckCellFn({ row: { original: trip } })}
        </tr>
      </tbody>
    </table>,
  );
}

function renderCard(trip: TripDetail) {
  return render(
    <MemoryRouter>
      <TripMobileCard trip={trip} warnThreshold={70} />
    </MemoryRouter>,
  );
}

describe('SIL-935 — bảng chuyến hiển thị chip Chờ biển', () => {
  it('XE cell: xe ngoài chưa biển → dash + chip Chờ biển', () => {
    renderTruckCell(mkExternalTrip(null));
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('Chờ biển')).toBeTruthy();
  });

  it('XE cell: xe ngoài có biển → biển số là câu trả lời, không chip', () => {
    renderTruckCell(mkExternalTrip('29K-777.77'));
    expect(screen.getByText('29K-777.77')).toBeTruthy();
    expect(screen.queryByText('Chờ biển')).toBeNull();
  });

  it('XE cell: đội nội bộ giữ nguyên dáng cũ — không chip', () => {
    renderTruckCell(mkOwnTrip());
    expect(screen.getByText('29H-111.11')).toBeTruthy();
    expect(screen.queryByText('Chờ biển')).toBeNull();
  });

  it('mobile card: xe ngoài chưa biển → chip Chờ biển cạnh dòng biển số', () => {
    renderCard(mkExternalTrip(null));
    expect(screen.getByText('Chờ biển')).toBeTruthy();
    // The Xe ngoài badge still rides the customer line.
    expect(screen.getByText('Xe ngoài')).toBeTruthy();
  });

  it('mobile card: xe ngoài có biển → không chip', () => {
    renderCard(mkExternalTrip('29K-777.77'));
    expect(screen.getByText('29K-777.77')).toBeTruthy();
    expect(screen.queryByText('Chờ biển')).toBeNull();
  });
});
