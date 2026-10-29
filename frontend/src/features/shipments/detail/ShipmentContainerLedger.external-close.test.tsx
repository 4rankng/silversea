import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { ShipmentContainerLedger } from './ShipmentContainerLedger';

// SIL-592 (id 692) — the CUS staff close ("Hoàn thành") for external-carrier
// trips on the Chi tiết lô hàng workboard. The action lives in the Trạng thái
// cell next to the dispatch chip and only for a live EXTERNAL trip.
const access = () => ({ mode: 'DIRECT', reason: 'trường kiểm thử' });

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  shipmentId: 1,
  shipmentVersion: 1,
  ordinal: 1,
  customerId: 1,
  isAdHoc: false,
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
  dispatchStatus: 'IN_TRANSIT',
  carrierName: 'Nhà xe Minh Phát',
  carrierType: 'EXTERNAL',
  plateNumber: '30A-123.45',
  actualTruckNo: null,
  billingTruckNo: null,
  revVehicleClassCode: null,
  costVehicleClassCode: null,
  liftSite: 'Cảng A',
  dropoffSite: 'KCN B',
  transportDate: '2026-10-29',
  closingAt: null,
  plannedReturnAt: null,
  customerAppointmentAt: '2026-10-29T08:00:00.000Z',
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
  dropsiteEditable: true,
  dropoffSiteEditable: true,
  routeEditable: true,
  customerAppointmentEditable: true,
  scheduleEditable: true,
  // The staff-close gating triple (SIL-592) — the wire carries it per row.
  tripId: 55,
  tripStatus: 'IN_TRANSIT',
  ...overrides,
}) as unknown as ShipmentCusContainerFlatRow;

function renderLedger(overrides: Record<string, unknown> = {}, onCompleteExternalTrip?: (row: ShipmentCusContainerFlatRow) => Promise<void>) {
  return render(
    <ShipmentContainerLedger
      rows={[row(overrides)]}
      totalContainers={1}
      today="2026-10-29"
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
      onCompleteExternalTrip={onCompleteExternalTrip}
    />,
    { wrapper: MemoryRouter },
  );
}

describe('ShipmentContainerLedger — SIL-592 Hoàn thành cho xe ngoài', () => {
  it('shows the close action on a live EXTERNAL row and completes through the confirm dialog', async () => {
    const onCompleteExternalTrip = vi.fn(async (_row: ShipmentCusContainerFlatRow) => {});
    renderLedger({}, onCompleteExternalTrip);
    const trigger = screen.getByRole('button', { name: 'Hoàn thành chuyến xe ngoài của MSKU1234567' });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(dialog.textContent).toContain('Hoàn thành chuyến với xe ngoài MSKU1234567');
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành chuyến' }));
    await waitFor(() => expect(onCompleteExternalTrip).toHaveBeenCalledTimes(1));
    expect(onCompleteExternalTrip.mock.calls[0][0]).toMatchObject({ tripId: 55 });
    // Success closes the dialog.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the dialog open when the close fails so the operator can retry or cancel', async () => {
    const onCompleteExternalTrip = vi.fn(async (_row: ShipmentCusContainerFlatRow) => { throw new Error('sập'); });
    renderLedger({}, onCompleteExternalTrip);
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành chuyến xe ngoài của MSKU1234567' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành chuyến' }));
    await waitFor(() => expect(onCompleteExternalTrip).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the action for a CREATED EXTERNAL trip — staff close admits CREATED directly', () => {
    renderLedger({ tripStatus: 'CREATED', dispatchStatus: 'CREATED' }, vi.fn(async () => {}));
    expect(screen.getByRole('button', { name: 'Hoàn thành chuyến xe ngoài của MSKU1234567' })).toBeTruthy();
  });

  it.each([
    ['OWN fleet', { carrierType: 'OWN', tripStatus: 'IN_TRANSIT' }],
    ['completed trip', { tripStatus: 'COMPLETED', dispatchStatus: 'COMPLETED' }],
    ['canceled trip', { tripStatus: 'CANCELED' }],
    ['planned line without a trip', { tripId: null, tripStatus: null, dispatchStatus: 'PLANNED' }],
    ['deferred-plate trip awaiting its biển số', { plateNumber: null, tripStatus: 'CREATED', dispatchStatus: 'PLANNED' }],
  ])('renders no close action for %s', (_label, overrides) => {
    renderLedger(overrides);
    expect(screen.queryByRole('button', { name: /Hoàn thành chuyến xe ngoài/ })).toBeNull();
  });

  it('renders no close action when the page passed no handler (role outside the allowlist)', () => {
    renderLedger({}, undefined);
    expect(screen.queryByRole('button', { name: /Hoàn thành chuyến xe ngoài/ })).toBeNull();
  });
});
