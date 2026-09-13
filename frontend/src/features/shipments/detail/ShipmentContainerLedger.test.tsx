import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import {
  ShipmentContainerLedger,
  type ShipmentDetailEditMode,
  type ShipmentScheduleDraft,
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

describe('ShipmentContainerLedger missing-fields summary', () => {
  function renderLedgerWithRow(row: ShipmentCusContainerFlatRow) {
    const onStartEdit = vi.fn();
    const view = render(
      <ShipmentContainerLedger
        rows={[row]}
        totalContainers={1}
        today="2026-09-10"
        sort={null}
        onSortChange={vi.fn()}
        activeEdit={null}
        editLoadingRowId={null}
        editError={null}
        onStartEdit={onStartEdit}
        onCancelEdit={vi.fn()}
        onSaveRoute={vi.fn(async () => {})}
        onSaveVehicle={vi.fn(async () => {})}
        onSaveSchedule={vi.fn(async () => {})}
        onSaveNotes={vi.fn(async () => {})}
        onSaveIdentity={vi.fn(async () => {})}
        onSaveDocuments={vi.fn(async () => {})}
        onSaveContainer={vi.fn(async () => {})}
      />,
    );
    return { view, onStartEdit };
  }

  it('collapses the missing list to a count control; key blockers stay visible outside it', () => {
    const row = baseRow({
      transportDate: null,
      customerAppointmentAt: null,
      informationStatus: 'MISSING',
      missingFields: [
        { code: 'TRANSPORT_DATE', label: 'Ngày vận chuyển' },
        { code: 'CONTAINER_NUMBER', label: 'Số container' },
        { code: 'BKS', label: 'Biển số xe' },
      ],
    });
    const { view } = renderLedgerWithRow(row);

    const toggle = screen.getByRole('button', { name: /Thiếu 3 thông tin/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Số container')).toBeNull();
    // Key dispatch blockers render without expanding anything: the schedule
    // cell's badge plus the summary rail stat both carry the date gap.
    expect(screen.getAllByText('Thiếu ngày vận chuyển').length).toBeGreaterThanOrEqual(2);
    view.unmount();
  });

  it('expands to jump-to-editor buttons that open the owning cell editor', () => {
    const row = baseRow({
      informationStatus: 'MISSING',
      missingFields: [
        { code: 'CONTAINER_NUMBER', label: 'Số container' },
        { code: 'BKS', label: 'Biển số xe' },
      ],
    });
    const { view, onStartEdit } = renderLedgerWithRow(row);

    fireEvent.click(screen.getByRole('button', { name: /Thiếu 2 thông tin/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Số container' }));
    expect(onStartEdit).toHaveBeenCalledWith(row, 'container', expect.stringContaining('shipment-detail-missing-CONTAINER_NUMBER-'));
    fireEvent.click(screen.getByRole('button', { name: 'Biển số xe' }));
    expect(onStartEdit).toHaveBeenLastCalledWith(row, 'vehicle', expect.stringContaining('shipment-detail-missing-BKS-'));
    view.unmount();
  });
});

describe('schedule editor lot transport date (non-FCL affordance)', () => {
  function renderScheduleEditor(cargoMode: 'FCL' | 'LCL') {
    const row = baseRow({ shipmentScheduleEditable: true });
    const onSaveSchedule = vi.fn(async (
      _line: ShipmentCusWorkspaceContainerLine,
      _row: ShipmentCusContainerFlatRow,
      _draft: ShipmentScheduleDraft,
    ) => {});
    const detail = { ...baseDetail(), summary: { ...baseDetail().summary, cargoMode } };
    const view = render(
      <ShipmentContainerLedger
        rows={[row]}
        totalContainers={1}
        today="2026-09-10"
        sort={null}
        onSortChange={vi.fn()}
        activeEdit={{ row, detail, line: baseLine(), mode: 'schedule' }}
        editLoadingRowId={null}
        editError={null}
        onStartEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onSaveRoute={vi.fn(async () => {})}
        onSaveVehicle={vi.fn(async () => {})}
        onSaveSchedule={onSaveSchedule}
        onSaveNotes={vi.fn(async () => {})}
        onSaveIdentity={vi.fn(async () => {})}
        onSaveDocuments={vi.fn(async () => {})}
        onSaveContainer={vi.fn(async () => {})}
      />,
    );
    return { view, onSaveSchedule };
  }

  it('LCL rows expose the lot transport date and save it in the schedule draft', () => {
    const { view, onSaveSchedule } = renderScheduleEditor('LCL');

    expect(screen.getByText('Ngày vận chuyển')).toBeTruthy();
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs).toHaveLength(2);
    fireEvent.change(dateInputs[1], { target: { value: '2026-09-20' } });
    fireEvent.click(screen.getByRole('button', { name: /^Lưu lịch trình/ }));
    expect(onSaveSchedule).toHaveBeenCalledTimes(1);
    const [, , draft] = onSaveSchedule.mock.calls[0];
    // Only the lot date moved — the appointment draft stays untouched (the
    // fixture's 08:00Z appointment reads 15:00 on the VN-pinned wall clock).
    expect(draft.transportDate).toBe('2026-09-20');
    expect(draft.customerAppointmentAt).toBe('2026-09-10T15:00');
    view.unmount();
  });

  it('FCL rows keep the schedule editor appointment-only', () => {
    const { view } = renderScheduleEditor('FCL');

    expect(screen.queryByText('Ngày vận chuyển')).toBeNull();
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(1);
    view.unmount();
  });
});
