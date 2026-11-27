/**
 * SIL-1142 (QA-Retest4) — the "Tách nhóm" verb must exist WHERE the merged
 * group is shown. The /shipments-detail lot board (Chi tiết lô) renders a
 * lot-level row's merge facts ("Lô hàng lẻ | Thu: Xe … | Trả: Xe …") but had
 * NO path back out of a merged group — QA could not untie from here in any
 * role. The row now carries the SHARED `UnmergeRevGroupAction` (the same
 * confirm + `POST /shipments/lcl/unmerge-group` channel the settlement
 * boards run), mounted inside the THÔNG SỐ CONTAINER cell right under the
 * facts that show the merge (FB-093: an action never separates from the
 * state it acts on).
 *
 * Pins: the action rides the page's role decision (showGroupUnmerge);
 * ungrouped rows render none; the dimension follows the wire (REV group →
 * REV copy, cost-only group → COST copy); a successful tách calls the
 * page's onRevGroupUnmerged reload.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function renderLedger(rows: ShipmentCusContainerFlatRow[], props: { onRevGroupUnmerged?: () => void } = {}) {
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
          showGroupUnmerge
          onRevGroupUnmerged={props.onRevGroupUnmerged}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  unmergeLclGroup.mockResolvedValue({
    dimension: 'REV',
    groupId: 'g-rev-1',
    memberCount: 2,
    members: [{ shipmentId: 71, order: 1, reference: 'R42CUS-LCL1' }],
    dissolved: true,
    vehicleClassId: 7,
  });
});

describe('SIL-1142 — Tách nhóm on the Chi tiết lô board', () => {
  it('a REV-merged lot row carries the real Tách nhóm button; click → confirm → unmergeLclGroup REV + reload', async () => {
    const onRevGroupUnmerged = vi.fn();
    renderLedger([lotRow({ revGroupId: 'g-rev-1' })], { onRevGroupUnmerged });

    const button = screen.getByRole('button', { name: 'Tách nhóm ghép cước thu khách — lô R42CUS-LCL1' });
    expect(button.tagName).toBe('BUTTON');
    fireEvent.click(button);
    // The shared confirm names the whole-group consequence before anything fires.
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Tách nhóm ghép cước thu khách?');
    expect(unmergeLclGroup).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Tách nhóm' }).at(-1)!);
    await waitFor(() => expect(unmergeLclGroup).toHaveBeenCalledWith({ groupId: 'g-rev-1', dimension: 'REV' }));
    await waitFor(() => expect(onRevGroupUnmerged).toHaveBeenCalled());
  });

  it('a cost-only merged lot unties through the SAME endpoint with the COST dimension', async () => {
    unmergeLclGroup.mockResolvedValue({
      dimension: 'COST', groupId: 'g-cost-1', memberCount: 2,
      members: [{ shipmentId: 71, order: 1, reference: 'R42CUS-LCL1' }], dissolved: true,
    });
    renderLedger([lotRow({ revGroupId: null, costGroupId: 'g-cost-1' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Tách nhóm ghép trả ĐV — lô R42CUS-LCL1' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Tách nhóm ghép trả ĐV?');
    fireEvent.click(screen.getAllByRole('button', { name: 'Tách nhóm' }).at(-1)!);
    await waitFor(() => expect(unmergeLclGroup).toHaveBeenCalledWith({ groupId: 'g-cost-1', dimension: 'COST' }));
  });

  it('ungrouped lot rows render no Tách nhóm, and the action follows the page role gate', () => {
    const base = {
      totalContainers: 1, today: '2026-10-26', sort: null, onSortChange: vi.fn(),
      activeEdit: null, editLoadingRowId: null, editError: null, onStartEdit: vi.fn(), onCancelEdit: vi.fn(),
      onSaveRoute: vi.fn(async () => {}), onSaveVehicle: vi.fn(async () => {}), onSaveSchedule: vi.fn(async () => {}),
      onSaveNotes: vi.fn(async () => {}), onSaveIdentity: vi.fn(async () => {}), onSaveDocuments: vi.fn(async () => {}),
      onSaveContainer: vi.fn(async () => {}),
    } as const;
    const { rerender } = render(
      <MemoryRouter>
        <ToastProvider>
          <ShipmentContainerLedger rows={[lotRow()]} {...base} showGroupUnmerge />
        </ToastProvider>
      </MemoryRouter>,
    );
    // Ungrouped: nothing to untie — no action even with full authority.
    expect(screen.queryByRole('button', { name: /Tách nhóm/ })).toBeNull();

    // Role without the merge authority: no destructive group action.
    rerender(
      <MemoryRouter>
        <ToastProvider>
          <ShipmentContainerLedger rows={[lotRow({ revGroupId: 'g-rev-1' })]} {...base} />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /Tách nhóm/ })).toBeNull();
  });
});
