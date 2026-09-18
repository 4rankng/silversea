// Regression lock for the detail workboard's bulk appointment copy affordance
// (customer request 2026-09-18). What matters behaviorally: the icon appears on
// a row that can act as a copy source (it has an appointment and its
// appointment field is writable) — this board's filters can hide a lot's other
// containers, so the affordance is source-gated and the write resolves the lot's
// own empty containers — it hands the clicked row to the caller, it lives in the
// identity cell without covering the customer text, it yields to an open edit
// session, and it locks itself mid-batch.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { ShipmentContainerLedger } from './ShipmentContainerLedger';

const access = (mode: 'DIRECT' | 'REQUEST' | 'READ_ONLY' = 'DIRECT') => ({ mode, reason: 'trường kiểm thử' });

const baseRow = (overrides: Partial<ShipmentCusContainerFlatRow> = {}) => ({
  id: 1,
  shipmentId: 1,
  shipmentVersion: 1,
  ordinal: 1,
  customerId: 1,
  customerName: 'Long Minh',
  factoryName: 'ASKEY-2',
  routeName: 'KCN Quế Võ',
  billOrBookNumber: 'EGLV149607019409',
  declarationNumber: null,
  shippingLineName: 'Evergreen',
  isCombined: false,
  classification: 'DOUBLE',
  direction: 'IMPORT',
  containerNumber: 'MSKU1234567',
  containerTypeLabel: "20'DC",
  dispatchStatus: 'AWAITING_VEHICLE',
  carrierName: 'SilverSea',
  plateNumber: null,
  liftSite: 'Cảng A',
  dropoffSite: 'KCN B',
  transportDate: '2026-09-10',
  closingAt: null,
  plannedReturnAt: null,
  customerAppointmentAt: '2026-09-10T08:00:00.000Z',
  customerNotes: null,
  operationalNotes: null,
  raw: { containerNumber: 'MSKU1234567', containerTypeId: 1, cargoWeightKg: null, cargoVolumeCbm: null },
  fieldAccess: {
    operationalSiteId: access(),
    containerNumber: access(),
    containerTypeId: access(),
    cargoWeightKg: access(),
    cargoVolumeCbm: access(),
    routeId: access(),
    liftSiteId: access(),
    dropoffSiteId: access(),
  },
  shipmentFieldAccess: {
    factoryName: access(),
    routeId: access(),
    deliveryLocation: access(),
    blNumber: access(),
    bookingRef: access(),
    tradeDirection: access(),
    shippingLineName: access(),
  },
  informationStatus: 'COMPLETE',
  missingFields: [],
  shipmentScheduleEditable: true,
  shipmentNotesEditable: true,
  carrierEditable: true,
  plateEditable: true,
  liftSiteEditable: true,
  dropoffSiteEditable: true,
  routeEditable: true,
  customerAppointmentEditable: true,
  scheduleEditable: true,
  ...overrides,
}) as ShipmentCusContainerFlatRow;

const baseDetail = () => ({
  summary: { id: 1, version: 5, cargoMode: 'FCL', raw: {}, fieldAccess: {} },
  selectors: { routes: [], containerTypes: [], operationalSites: [], externalCarriers: [], carrierVehicles: [], ports: [] },
  containers: [],
}) as unknown as ShipmentCusWorkspaceDetail;

const baseLine = (overrides: Partial<ShipmentCusWorkspaceContainerLine> = {}) => ({
  id: 1,
  ordinal: 1,
  containerNumber: 'MSKU1234567',
  containerTypeId: 1,
  containerTypeLabel: "20'DC",
  routeId: 3,
  routeName: 'KCN Quế Võ',
  dispatchStatus: 'AWAITING_VEHICLE',
  tripId: null,
  tripStatus: null,
  carrierType: 'OWN',
  externalCarrierId: null,
  externalCarrierVehicleId: null,
  carrierName: 'SilverSea',
  plateNumber: null,
  liftSiteId: 6,
  liftSite: 'Cảng A',
  dropoffSiteId: 46,
  dropoffSite: 'KCN B',
  customerAppointmentAt: '2026-09-10T08:00:00.000Z',
  raw: { containerNumber: 'MSKU1234567', containerTypeId: 1, cargoWeightKg: null, cargoVolumeCbm: null, routeId: 3 },
  fieldAccess: {
    operationalSiteId: access(),
    containerNumber: access(),
    containerTypeId: access(),
    cargoWeightKg: access(),
    cargoVolumeCbm: access(),
    routeId: access(),
  },
  permissions: {
    carrierEditable: true,
    plateEditable: true,
    containerTypeEditable: true,
    routeEditable: true,
    liftSiteEditable: true,
    dropoffSiteEditable: true,
    customerAppointmentEditable: true,
  },
  shipmentVersion: 1,
  relatedTripVersion: null,
  ...overrides,
}) as unknown as ShipmentCusWorkspaceContainerLine;

function renderLedger(
  rows: ShipmentCusContainerFlatRow[],
  options: {
    onCopyAppointmentToEmpty?: (source: ShipmentCusContainerFlatRow) => void;
    copying?: boolean;
    activeEdit?: { row: ShipmentCusContainerFlatRow; detail: ShipmentCusWorkspaceDetail; line: ShipmentCusWorkspaceContainerLine; mode: 'schedule' } | null;
  } = {},
) {
  const onCopyAppointmentToEmpty = vi.fn(options.onCopyAppointmentToEmpty);
  const view = render(
    <ShipmentContainerLedger
      rows={rows}
      totalContainers={rows.length}
      today="2026-09-10"
      sort={null}
      onSortChange={vi.fn()}
      activeEdit={options.activeEdit ?? null}
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
      onCopyAppointmentToEmpty={onCopyAppointmentToEmpty}
      copying={options.copying}
    />,
  );
  return { ...view, onCopyAppointmentToEmpty };
}

/** Every eligible row renders its own affordance — a row that already has an
 *  appointment is a source no matter how many dated siblings it has. */
const copyButtons = () => screen.queryAllByRole('button', { name: /Copy ngày giờ đóng trả/ });
const undated = (id: number, ordinal: number) => baseRow({ id, ordinal, containerNumber: `MSKU000000${ordinal}`, customerAppointmentAt: null });

describe('ShipmentContainerLedger bulk appointment copy', () => {
  it('offers the copy affordance in the identity cell and never over the schedule cell', () => {
    const source = baseRow();
    renderLedger([source, undated(2, 2), undated(3, 3)]);

    const button = copyButtons()[0];
    expect(button).toBeDefined();
    expect(button!.closest('th')?.getAttribute('data-label')).toBe('Khách hàng & lộ trình');
    expect(button!.closest('td[data-label="Lịch trình"]')).toBeNull();
    // The button is a direct child of the identity cell, which is what the
    // stylesheet keys on to reserve the gutter that keeps the icon off the
    // customer text (ShipmentContainersPage.styles.test.ts).
    expect(button!.parentElement?.getAttribute('data-label')).toBe('Khách hàng & lộ trình');
  });

  it('hands the clicked row to the caller as the copy source, once per click', () => {
    const source = baseRow({ id: 1 });
    const { onCopyAppointmentToEmpty } = renderLedger([source, undated(2, 2), undated(5, 5)]);

    fireEvent.click(copyButtons()[0]);

    expect(onCopyAppointmentToEmpty).toHaveBeenCalledTimes(1);
    expect(onCopyAppointmentToEmpty.mock.calls[0]).toHaveLength(1);
    const [passedSource] = onCopyAppointmentToEmpty.mock.calls[0];
    expect(passedSource.id).toBe(1);
    expect(passedSource.customerAppointmentAt).toBe('2026-09-10T08:00:00.000Z');
  });

  it('hides the affordance without an appointment, without write access, or while a row is being edited', () => {
    const undatedSource = baseRow({ id: 1, customerAppointmentAt: null });
    const { unmount } = renderLedger([undatedSource, undated(2, 2), undated(3, 3)]);
    expect(copyButtons()).toHaveLength(0);
    unmount();

    const readOnlySource = baseRow({ id: 1, customerAppointmentEditable: false });
    const second = renderLedger([readOnlySource, undated(2, 2), undated(3, 3)]);
    expect(copyButtons()).toHaveLength(0);
    second.unmount();

    const editing = renderLedger([baseRow({ id: 1 }), undated(2, 2), undated(3, 3)], {
      activeEdit: { row: baseRow({ id: 1 }), detail: baseDetail(), line: baseLine(), mode: 'schedule' },
    });
    expect(copyButtons()).toHaveLength(0);
    editing.unmount();
  });

  it('locks the affordance while a copy batch is in flight', () => {
    const { onCopyAppointmentToEmpty } = renderLedger([baseRow({ id: 1 }), undated(2, 2), undated(3, 3)], { copying: true });

    const button = copyButtons()[0] as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onCopyAppointmentToEmpty).not.toHaveBeenCalled();
  });
});
