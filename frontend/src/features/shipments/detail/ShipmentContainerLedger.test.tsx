import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import {
  ShipmentContainerLedger,
  type ShipmentDetailEditMode,
} from './ShipmentContainerLedger';

// Minimal row/line/detail fixtures — the ledger only reads a per-mode subset,
// mirroring the thin-cast fixture precedent in ShipmentContainerScheduleEditor.test.tsx.
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

const baseLine = () => ({
  id: 11,
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
    containerNumber: access(),
    containerTypeId: access(),
    cargoWeightKg: access(),
    cargoVolumeCbm: access(),
    routeId: access(),
    carrierType: access(),
    externalCarrierId: access(),
    externalCarrierVehicleId: access(),
    plateNumber: access(),
    liftSiteId: access(),
    dropoffSiteId: access(),
    customerAppointmentAt: access(),
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
}) as ShipmentCusWorkspaceContainerLine;

const baseDetail = () => ({
  summary: {
    id: 1,
    version: 5,
    cargoMode: 'FCL',
    raw: {
      factoryName: 'ASKEY-2',
      routeId: 3,
      deliveryLocation: 'KCN B',
      blNumber: 'EGLV149607019409',
      bookingRef: null,
      tradeDirection: 'IMPORT',
      shippingLineName: 'Evergreen',
    },
    fieldAccess: {
      customerId: access(),
      factoryName: access(),
      routeId: access(),
      deliveryLocation: access(),
      blNumber: access(),
      bookingRef: access(),
      declarationNumber: access(),
      tradeDirection: access(),
      shippingLineName: access(),
    },
  },
  selectors: {
    routes: [{ id: 3, name: 'KCN Quế Võ', label: 'KCN Quế Võ' }],
    containerTypes: [{ id: 1, code: '20DC', name: "20'DC", label: "20'DC" }],
    operationalSites: [],
    externalCarriers: [],
    carrierVehicles: [],
    ports: [],
  },
  containers: [],
}) as unknown as ShipmentCusWorkspaceDetail;

function renderLedger(mode: ShipmentDetailEditMode) {
  const row = baseRow();
  const onCancelEdit = vi.fn();
  const view = render(
    <ShipmentContainerLedger
      rows={[row]}
      totalContainers={1}
      today="2026-09-10"
      sort={null}
      onSortChange={vi.fn()}
      activeEdit={{ row, detail: baseDetail(), line: baseLine(), mode }}
      editLoadingRowId={null}
      editError={null}
      onStartEdit={vi.fn()}
      onCancelEdit={onCancelEdit}
      onSaveRoute={vi.fn(async () => {})}
      onSaveVehicle={vi.fn(async () => {})}
      onSaveSchedule={vi.fn(async () => {})}
      onSaveNotes={vi.fn(async () => {})}
      onSaveIdentity={vi.fn(async () => {})}
      onSaveDocuments={vi.fn(async () => {})}
      onSaveContainer={vi.fn(async () => {})}
    />,
  );
  return { ...view, onCancelEdit };
}

describe('ShipmentContainerLedger inline editor dismissal', () => {
  it('documents editor closes on outside pointerdown', () => {
    const { onCancelEdit } = renderLedger('documents');
    fireEvent.pointerDown(document.body);
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it('documents editor closes on outside mousedown', () => {
    const { onCancelEdit } = renderLedger('documents');
    fireEvent.mouseDown(document.body);
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it('documents editor stays open when the press lands inside it', () => {
    const { container, onCancelEdit } = renderLedger('documents');
    const editor = container.querySelector('.shipment-container-ledger__inline-editor')!;
    fireEvent.pointerDown(editor);
    expect(onCancelEdit).not.toHaveBeenCalled();
  });

  it('documents editor closes on global Escape', () => {
    const { onCancelEdit } = renderLedger('documents');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it('documents editor ignores presses inside the portaled react-aria popover', () => {
    const { onCancelEdit } = renderLedger('documents');
    // The UuiSelectField listbox portals to document.body — a press picking an
    // option must select, not cancel the whole editor.
    const portal = document.createElement('div');
    portal.className = 'react-aria-Popover';
    document.body.appendChild(portal);
    try {
      fireEvent.pointerDown(portal);
      expect(onCancelEdit).not.toHaveBeenCalled();
    } finally {
      portal.remove();
    }
  });

  it('vehicle editor closes on outside press and ignores the portaled searchable-select popover', () => {
    const { container, onCancelEdit } = renderLedger('vehicle');
    const editor = container.querySelector('.shipment-container-ledger__inline-editor')!;

    fireEvent.pointerDown(editor);
    expect(onCancelEdit).not.toHaveBeenCalled();

    const portal = document.createElement('div');
    portal.className = 'searchable-select__popover';
    document.body.appendChild(portal);
    try {
      fireEvent.pointerDown(portal);
      expect(onCancelEdit).not.toHaveBeenCalled();
    } finally {
      portal.remove();
    }

    fireEvent.pointerDown(document.body);
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it('schedule editor closes on outside pointerdown', () => {
    const { onCancelEdit } = renderLedger('schedule');
    fireEvent.pointerDown(document.body);
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it('identity editor closes on outside pointerdown', () => {
    const { onCancelEdit } = renderLedger('identity');
    fireEvent.pointerDown(document.body);
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });
});
