/**
 * SIL-1166 (KB K3.79/K4.31) — a merged hàng-lẻ row on /shipments-detail shows
 * the PHÂN LOẠI tag "Lẻ · Ghép (k/N)" beside the classification label.
 *
 * Pins:
 * - the rev-merged lot row reads "Lẻ · Ghép (1/2)" (rev order/count);
 * - cost leads when the lot rides both dimensions (the W3A precedence the
 *   master-plan chip runs);
 * - ungrouped rows keep the bare classification;
 * - SIL-1135's placement law still holds: the classification span stays the
 *   schedule line's last element (the tag nests INSIDE it).
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shipmentCusContainerFlatRowSchema, type ShipmentCusContainerFlatRow } from '@tingting/shared';

const { unmergeLclGroup, mergeLclRevGroup } = vi.hoisted(() => ({ unmergeLclGroup: vi.fn(), mergeLclRevGroup: vi.fn() }));
vi.mock('../../../api/dispatchPlanningClient', () => ({
  unmergeLclGroup,
  mergeLclRevGroup,
  setLclLotRevClass: vi.fn(),
  updateLclTruck: vi.fn(),
  listDispatchFleetResources: vi.fn(async () => ({ items: [] })),
}));
vi.mock('../../../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: [], isLoading: false }),
}));

import { ShipmentContainerLedger } from './ShipmentContainerLedger';
import { ToastProvider } from '../../../components/shared/Toast';

const access = (mode: 'DIRECT' | 'READ_ONLY' = 'DIRECT') => ({ mode, reason: 'trường kiểm thử' });

const lotRow = (overrides: Partial<ShipmentCusContainerFlatRow> = {}): ShipmentCusContainerFlatRow =>
  shipmentCusContainerFlatRowSchema.parse({
    id: -71,
    shipmentId: 71,
    shipmentVersion: 3,
    ordinal: 1,
    customerId: 1,
    isAdHoc: false,
    customerName: 'LOG COM',
    creatorName: null,
    creatorCode: null,
    factoryName: null,
    routeName: null,
    billOrBookNumber: 'R42CUS-LCL1',
    declarationNumber: null,
    shippingLineName: null,
    isCombined: false,
    classification: 'LCL',
    direction: 'IMPORT',
    containerNumber: null,
    containerTypeLabel: null,
    dispatchStatus: 'AWAITING_VEHICLE',
    carrierName: null,
    carrierType: null,
    plateNumber: null,
    tripId: null,
    tripStatus: null,
    tripDepartureDate: null,
    actualTruckNo: null,
    billingTruckNo: null,
    revVehicleClassCode: '3.5T',
    costVehicleClassCode: null,
    revGroupId: null,
    costGroupId: null,
    revFreightManual: null,
    liftSite: null,
    dropoffSite: null,
    transportDate: '2026-10-26',
    closingAt: null,
    plannedReturnAt: null,
    customerAppointmentAt: null,
    customerNotes: null,
    operationalNotes: null,
    raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null },
    fieldAccess: {
      operationalSiteId: access(), containerNumber: access(), containerTypeId: access(),
      cargoWeightKg: access(), cargoVolumeCbm: access(), routeId: access(),
      liftSiteId: access(), dropoffSiteId: access(),
    },
    shipmentFieldAccess: {
      customerId: access(), factoryName: access(), routeId: access(), deliveryLocation: access(),
      blNumber: access(), bookingRef: access(), declarationNumber: access(), tradeDirection: access(),
      shippingLineName: access(), packageCount: access(), packageType: access(),
      cargoWeightKg: access(), cargoVolumeCbm: access(), customsCutoffAt: access(), closingAt: access(),
      plannedReturnAt: access(), customerNotes: access(), operationalNotes: access(),
    },
    informationStatus: 'COMPLETE',
    missingFields: [],
    shipmentScheduleEditable: false,
    shipmentNotesEditable: false,
    carrierEditable: false,
    plateEditable: false,
    liftSiteEditable: false,
    dropoffSiteEditable: false,
    routeEditable: false,
    customerAppointmentEditable: false,
    scheduleEditable: false,
    isLotLevel: true,
    ...overrides,
  });

function renderLedger(rows: ShipmentCusContainerFlatRow[]) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ShipmentContainerLedger
          rows={rows}
          totalContainers={rows.length}
          today="2026-10-26"
          sort={null}
          onSortChange={vi.fn()}
          activeEdit={null}
          editLoadingRowId={null}
          editError={null}
          onStartEdit={vi.fn()}
          onCancelEdit={vi.fn()}
          onSaveRoute={vi.fn(async () => {})}
          onSaveVehicle={vi.fn(async () => {})}
          onSaveSchedule={vi.fn(async () => {})}
          onSaveNotes={vi.fn(async () => {})}
          onSaveIdentity={vi.fn(async () => {})}
          onSaveDocuments={vi.fn(async () => {})}
          onSaveContainer={vi.fn(async () => {})}
          showGroupUnmerge={false}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function classificationText(): string {
  const found = document.querySelector('.shipment-container-ledger__container-classification');
  if (!(found instanceof HTMLElement)) throw new Error('no classification span');
  return (found.textContent ?? '').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SIL-1166 — /shipments-detail PHÂN LOẠI tag', () => {
  it('a rev-merged lot reads "Lẻ · Ghép (1/2)"', () => {
    renderLedger([lotRow({
      revGroupId: 'g-rev-1',
      revGroupOrder: 1,
      revGroupMemberCount: 2,
    })]);
    expect(classificationText()).toBe('Lẻ · Ghép (1/2)');
  });

  it('cost leads when the lot rides both dimensions', () => {
    renderLedger([lotRow({
      costGroupId: 'g-cost-1',
      costGroupOrder: 2,
      costGroupMemberCount: 3,
      revGroupId: 'g-rev-1',
      revGroupOrder: 1,
      revGroupMemberCount: 2,
    })]);
    expect(classificationText()).toBe('Lẻ · Ghép (2/3)');
  });

  it('an ungrouped lot keeps the bare classification', () => {
    renderLedger([lotRow()]);
    expect(classificationText()).toBe('Lẻ');
  });

  it('SIL-1135 placement holds: the classification span stays the schedule last element', () => {
    renderLedger([lotRow({
      revGroupId: 'g-rev-1',
      revGroupOrder: 1,
      revGroupMemberCount: 2,
    })]);
    const span = document.querySelector('.shipment-container-ledger__container-classification');
    expect(span?.parentElement?.lastElementChild).toBe(span);
  });
});
