import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { CusLotView } from './CusLotView';

// SIL-714 (Spec I.4e) — the drawer's Nhà xe / BKS cell becomes a click-to-edit
// trigger (D2 quick edit) for a live EXTERNAL trip still awaiting its plate;
// the shared Cập nhật biển số dialog the host owns opens from it. Plated,
// OWN-fleet and terminal lines stay plain text.
function makeLine(overrides: Record<string, unknown> & { id: number; ordinal: number }): ShipmentCusWorkspaceContainerLine {
  return {
    operationalSiteId: null,
    containerNumber: `MSKU${String(100000 + overrides.id).slice(0, 7)}0`,
    declarationNumber: null,
    containerTypeId: null,
    containerTypeLabel: '40DC',
    routeId: null,
    routeName: null,
    dispatchStatus: 'CREATED',
    tripId: 55,
    tripStatus: 'CREATED',
    carrierType: 'EXTERNAL',
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    carrierName: 'ĐĂNG QUÂN',
    plateNumber: null,
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
    customerName: 'Khách SIL-714',
    cargoMode: 'FCL',
    isCombined: false,
    declarationNumbers: [],
    billOrBookNumber: 'BILL-714',
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
  onUpdateExternalPlate?: (line: ShipmentCusWorkspaceContainerLine) => void,
) {
  return render(
    <CusLotView
      item={makeItem()}
      detail={makeDetail(lines)}
      loading={false}
      onRetry={() => {}}
      onUpdateExternalPlate={onUpdateExternalPlate}
    />,
  );
}

describe('CusLotView — SIL-714 cập nhật biển số xe ngoài trong lot panel', () => {
  it('the awaiting-plate external line renders the click-to-edit trigger and opens the dialog through the host', () => {
    const onUpdateExternalPlate = vi.fn();
    const line = makeLine({ id: 11, ordinal: 1 });
    renderView([line], onUpdateExternalPlate);

    const trigger = screen.getByRole('button', { name: `Cập nhật biển số xe ngoài cho ${line.containerNumber}` });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(trigger);
    expect(onUpdateExternalPlate).toHaveBeenCalledWith(line);
  });

  it('plated, OWN-fleet and terminal lines stay plain text (no trigger)', () => {
    renderView([
      makeLine({ id: 21, ordinal: 1, plateNumber: '60H-714.98' }),
      makeLine({ id: 22, ordinal: 2, carrierType: 'OWN', carrierName: 'SilverSea', plateNumber: '15H-052.82' }),
      makeLine({ id: 23, ordinal: 3, tripStatus: 'COMPLETED', dispatchStatus: 'COMPLETED' }),
    ], vi.fn());

    expect(screen.queryByRole('button', { name: /Cập nhật biển số/ })).toBeNull();
    expect(screen.getByText('ĐĂNG QUÂN · 60H-714.98')).toBeTruthy();
  });

  it('no trigger without the host handler (role outside the allowlist)', () => {
    renderView([makeLine({ id: 31, ordinal: 1 })]);

    expect(screen.queryByRole('button', { name: /Cập nhật biển số/ })).toBeNull();
    expect(screen.getByText('ĐĂNG QUÂN')).toBeTruthy();
  });
});
