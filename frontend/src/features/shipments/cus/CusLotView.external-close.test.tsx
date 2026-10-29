import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { CusLotView } from './CusLotView';

// SIL-592 (id 692) — the drawer's per-container Trạng thái cell restores the
// CUS staff close ("Hoàn thành") SIL-485's read-only rewrite dropped: live
// EXTERNAL trips are closable from the review sheet's status cell.
function makeLine(overrides: Record<string, unknown> & { id: number; ordinal: number }): ShipmentCusWorkspaceContainerLine {
  return {
    operationalSiteId: null,
    containerNumber: `MSKU${String(100000 + overrides.id).slice(0, 7)}0`,
    declarationNumber: null,
    containerTypeId: null,
    containerTypeLabel: '40DC',
    routeId: null,
    routeName: null,
    dispatchStatus: 'IN_TRANSIT',
    tripId: 55,
    tripStatus: 'IN_TRANSIT',
    carrierType: 'EXTERNAL',
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    carrierName: 'Nhà xe Minh Phát',
    plateNumber: '30A-123.45',
    liftSiteId: null,
    liftSite: null,
    dropoffSiteId: null,
    dropoffSite: null,
    customerAppointmentAt: null,
    raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null, routeId: null },
    fieldAccess: {},
    permissions: {
      carrierEditable: false, plateEditable: false, containerTypeEditable: false,
      routeEditable: false, liftSiteEditable: false, dropoffSiteEditable: false,
      customerAppointmentEditable: false,
    },
    shipmentVersion: 1,
    relatedTripVersion: null,
    ...overrides,
  } as ShipmentCusWorkspaceContainerLine;
}

function makeItem(): ShipmentCusWorkspaceListItem {
  return {
    id: 77,
    customerName: 'Khách SIL-592',
    cargoMode: 'FCL',
    isCombined: false,
    declarationNumbers: [],
    billOrBookNumber: 'BILL-592',
    shippingLineName: null,
    appointmentGroups: [],
    plannedReturnAt: null,
    customerNotes: null,
    operationalNotes: null,
    raw: { tradeDirection: 'IMPORT', isAdHoc: false },
    operational: { scheduleReadiness: 'SCHEDULED', vehicleReadiness: 'READY', missingCarrierContainers: 0, missingPlateContainers: 0 },
    finance: { isLoss: false, hasPendingRecovery: false, customerChargeTotalsAvailable: false, customerInvoiceTotal: null, customerNoInvoiceTotal: null, totalCost: null },
    documentCustody: { status: 'NONE', label: null },
    accountingConfirmation: { status: 'PENDING' },
    activeLock: null,
    action: { kind: 'NONE', enabled: false },
    debitNote: { available: true },
  } as unknown as ShipmentCusWorkspaceListItem;
}

function makeDetail(lines: ShipmentCusWorkspaceContainerLine[]): ShipmentCusWorkspaceDetail {
  return { summary: makeItem(), containers: lines, selectors: { operationalSites: [] } } as unknown as ShipmentCusWorkspaceDetail;
}

function renderView(
  lines: ShipmentCusWorkspaceContainerLine[],
  onCompleteExternalTrip?: (line: ShipmentCusWorkspaceContainerLine) => Promise<void>,
) {
  return render(
    <CusLotView
      item={makeItem()}
      detail={makeDetail(lines)}
      loading={false}
      error={undefined}
      onRetry={() => {}}
      onCompleteExternalTrip={onCompleteExternalTrip}
    />,
  );
}

describe('CusLotView — SIL-592 Hoàn thành cho xe ngoài trong drawer', () => {
  it('completes the live EXTERNAL line through the confirm dialog', async () => {
    const onCompleteExternalTrip = vi.fn(async (_line: ShipmentCusWorkspaceContainerLine) => {});
    renderView([makeLine({ id: 11, ordinal: 1, containerNumber: 'MSKU1000110' })], onCompleteExternalTrip);
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành chuyến xe ngoài của MSKU1000110' }));
    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(dialog.textContent).toContain('Hoàn thành chuyến với xe ngoài MSKU1000110');
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành chuyến' }));
    await waitFor(() => expect(onCompleteExternalTrip).toHaveBeenCalledTimes(1));
    expect(onCompleteExternalTrip.mock.calls[0][0]).toMatchObject({ tripId: 55 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders no close action for an OWN line, a completed line, a deferred-plate line, or without a handler', () => {
    const { unmount } = renderView([
      makeLine({ id: 11, ordinal: 1, containerNumber: 'MSKU1000110', carrierType: 'OWN', tripStatus: 'IN_TRANSIT' }),
      makeLine({ id: 12, ordinal: 2, containerNumber: 'MSKU1000120', tripStatus: 'COMPLETED', dispatchStatus: 'COMPLETED' }),
      makeLine({ id: 13, ordinal: 3, containerNumber: 'MSKU1000130', plateNumber: null, tripStatus: 'CREATED', dispatchStatus: 'PLANNED' }),
    ], vi.fn(async () => {}));
    expect(screen.queryByRole('button', { name: /Hoàn thành chuyến xe ngoài/ })).toBeNull();
    unmount();
    renderView([makeLine({ id: 11, ordinal: 1, containerNumber: 'MSKU1000110' })], undefined);
    expect(screen.queryByRole('button', { name: /Hoàn thành chuyến xe ngoài/ })).toBeNull();
  });
});
