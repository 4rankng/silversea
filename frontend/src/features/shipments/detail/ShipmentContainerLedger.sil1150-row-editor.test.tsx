/**
 * SIL-1150 + CHK35 evidence 27/11 — the Chi tiết lô board's row-level laws.
 *
 * SIL-1150 (KB Ch.3 §3.1.7): clicking the container ROW opens the SHARED lot
 * editor for that row's lot (the page wires `/shipments/:id/edit` — the
 * create form in edit mode) instead of leaving the row inert behind the
 * per-cell dialogs. The per-cell triggers keep their own actions (SIL-503's
 * cell law) and never bubble into the row handler; a board without the
 * wiring (Ghép bộ Debit) keeps inert rows.
 *
 * CHK35 evidence 27/11 (KB Ch.3 §3.7.4 + §3.6.2): a merged hàng-lẻ row's
 * PHÂN LOẠI tag carries the group — `Lẻ · Ghép (k/N)` with k = the row's
 * 1-based order and N = the group's live member count (cost side leads, rev
 * side follows — the same precedence as the dispatch chip's lclLotFlag); an
 * ungrouped row stays bare 'Lẻ'.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
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

const lotRow = (overrides: Partial<ShipmentCusContainerFlatRow> = {}): ShipmentCusContainerFlatRow =>
  shipmentCusContainerFlatRowSchema.parse({
    // Per-field access + shipment-level access (DIRECT/READ_ONLY) + the raw
    // cell facts — fixtures read everything directly.
    fieldAccess: Object.fromEntries([
      'operationalSiteId', 'containerNumber', 'containerTypeId', 'cargoWeightKg',
      'cargoVolumeCbm', 'routeId', 'liftSiteId', 'dropoffSiteId',
    ].map((key) => [key, { mode: 'DIRECT', reason: 'trường kiểm thử' }])),
    shipmentFieldAccess: Object.fromEntries([
      'customerId', 'factoryName', 'routeId', 'deliveryLocation', 'blNumber', 'bookingRef',
      'declarationNumber', 'tradeDirection', 'shippingLineName', 'packageCount', 'packageType',
      'cargoWeightKg', 'cargoVolumeCbm', 'customsCutoffAt', 'closingAt', 'plannedReturnAt',
      'customerNotes', 'operationalNotes',
    ].map((key) => [key, { mode: 'DIRECT', reason: 'trường kiểm thử' }])),
    raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null },
    operationalNotes: null,
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

const baseProps = {
  totalContainers: 1,
  today: '2026-10-26',
  sort: null,
  onSortChange: vi.fn(),
  activeEdit: null,
  editLoadingRowId: null,
  editError: null,
  onStartEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  onSaveRoute: vi.fn(async () => {}),
  onSaveVehicle: vi.fn(async () => {}),
  onSaveSchedule: vi.fn(async () => {}),
  onSaveNotes: vi.fn(async () => {}),
  onSaveIdentity: vi.fn(async () => {}),
  onSaveDocuments: vi.fn(async () => {}),
  onSaveContainer: vi.fn(async () => {}),
} as const;

function renderLedger(rows: ShipmentCusContainerFlatRow[], props: { onOpenLotEditor?: (row: ShipmentCusContainerFlatRow) => void } = {}) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ShipmentContainerLedger
          rows={rows}
          {...baseProps}
          onOpenLotEditor={props.onOpenLotEditor}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('SIL-1150 — row click opens the shared lot editor', () => {
  it('clicking the row outside a trigger opens the row lot editor', () => {
    const onOpenLotEditor = vi.fn();
    const row = lotRow();
    renderLedger([row], { onOpenLotEditor });

    const tr = document.getElementById(`shipment-row-details-${row.id}`) as HTMLElement;
    expect(tr.className).toContain('shipment-container-ledger__row--open-editor');
    fireEvent.click(tr);
    expect(onOpenLotEditor).toHaveBeenCalledTimes(1);
    expect(onOpenLotEditor).toHaveBeenCalledWith(row);
  });

  it('a cell trigger keeps its own action and never bubbles into the row handler', () => {
    const onOpenLotEditor = vi.fn();
    renderLedger([lotRow()], { onOpenLotEditor });

    fireEvent.click(screen.getAllByRole('button', { name: /^Chỉnh sửa ô chứng từ và hãng tàu/ })[0]);
    expect(onOpenLotEditor).not.toHaveBeenCalled();
    expect(baseProps.onStartEdit).toHaveBeenCalled();
  });

  it('rows without the wiring stay inert (Ghép bộ Debit board)', () => {
    renderLedger([lotRow()]);
    const tr = document.getElementById('shipment-row-details--71') as HTMLElement;
    expect(tr.className).not.toContain('shipment-container-ledger__row--open-editor');
  });
});

describe('CHK35 — merged PHÂN LOẠI tag reads Lẻ · Ghép (k/N)', () => {
  it('cost side leads with its order/count, rev side follows, ungrouped stays bare', () => {
    renderLedger([
      lotRow({ costGroupId: 'g-cost-1', costGroupOrder: 1, costGroupMemberCount: 2 }),
      lotRow({ id: -72, shipmentId: 72, billOrBookNumber: 'R42CUS-LCL2', revGroupId: 'g-rev-1', revGroupOrder: 2, revGroupMemberCount: 3 }),
      lotRow({ id: -73, shipmentId: 73, billOrBookNumber: 'R42CUS-LCL3' }),
    ]);

    const tags = Array.from(document.querySelectorAll('.shipment-container-ledger__container-classification')).map((el) => el.textContent);
    expect(tags).toEqual(['Lẻ · Ghép (1/2)', 'Lẻ · Ghép (2/3)', 'Lẻ']);
  });

  it('a merged row without the count wire degrades to the bare · Ghép suffix', () => {
    renderLedger([lotRow({ revGroupId: 'g-rev-9' })]);
    const tags = Array.from(document.querySelectorAll('.shipment-container-ledger__container-classification')).map((el) => el.textContent);
    expect(tags).toEqual(['Lẻ · Ghép']);
  });
});
