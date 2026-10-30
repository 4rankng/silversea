// SIL-595 (id 695) — the CUS drawer "Chi tiết lô" renders the container
// appointment ("Đóng / trả" column + "Lịch cont" group lines) from the server's
// RAW instant (`Date.toISOString()` — Z-suffixed UTC). Naive string-surgery on
// those digits showed "07:30 30/10" for a 14:30 ICT appointment — 7 hours off
// the Tổng quan / chi tiết lô. Pin the Vietnam wall-clock on the drawer.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { CusLotView } from './CusLotView';

const direct = { mode: 'DIRECT' as const, reason: 'writable' };

function makeLine(overrides: Partial<ShipmentCusWorkspaceContainerLine> & { id: number; ordinal: number }): ShipmentCusWorkspaceContainerLine {
  return {
    operationalSiteId: null,
    containerNumber: `MSKU${String(100000 + overrides.id).slice(0, 7)}0`,
    declarationNumber: null,
    containerTypeId: 3,
    containerTypeLabel: '20DC',
    routeId: null,
    routeName: null,
    dispatchStatus: 'AWAITING_VEHICLE',
    tripId: null,
    tripStatus: null,
    carrierType: null,
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    carrierName: null,
    plateNumber: null,
    liftSiteId: null,
    liftSite: null,
    dropoffSiteId: null,
    dropoffSite: null,
    customerAppointmentAt: null,
    raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: '24000.00', cargoVolumeCbm: null, routeId: null },
    fieldAccess: {
      containerNumber: direct,
      containerTypeId: direct,
      cargoWeightKg: direct,
    },
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

function makeItem(overrides: Partial<ShipmentCusWorkspaceListItem> = {}): ShipmentCusWorkspaceListItem {
  return {
    id: 78,
    customerName: 'Khách SIL-595',
    cargoMode: 'FCL',
    isCombined: false,
    declarationNumbers: [],
    billOrBookNumber: 'BILL-595',
    shippingLineName: null,
    appointmentGroups: [],
    plannedReturnAt: null,
    customerNotes: null,
    operationalNotes: null,
    raw: { tradeDirection: 'EXPORT', isAdHoc: false },
    operational: { scheduleReadiness: 'SCHEDULED', vehicleReadiness: 'READY', missingCarrierContainers: 0, missingPlateContainers: 0 },
    finance: { isLoss: false, hasPendingRecovery: false, customerChargeTotalsAvailable: false, customerInvoiceTotal: null, customerNoInvoiceTotal: null, totalCost: null },
    documentCustody: { status: 'NONE', label: null },
    accountingConfirmation: { status: 'PENDING' },
    activeLock: null,
    action: { kind: 'NONE', enabled: false },
    debitNote: { available: true },
    ...overrides,
  } as unknown as ShipmentCusWorkspaceListItem;
}

function renderView(lines: ShipmentCusWorkspaceContainerLine[], itemOverrides: Partial<ShipmentCusWorkspaceListItem> = {}) {
  return render(
    <CusLotView
      item={makeItem(itemOverrides)}
      detail={{ summary: makeItem(itemOverrides), containers: lines, selectors: { containerTypes: [] } } as unknown as ShipmentCusWorkspaceDetail}
      loading={false}
      error={undefined}
      onRetry={() => {}}
      canEditCargoLines={false}
      containerLineActions={{
        onSaveField: async () => false,
      }}
    />,
  );
}

describe('CusLotView — SIL-595 giờ hẹn đóng/trả render ICT (GMT+7)', () => {
  // The QA symptom verbatim: server instant 07:30Z = 14:30 30/10 ICT, and the
  // drawer showed "07:30 30/10" while every other surface showed 14:30.
  const instant = '2026-10-30T07:30:00.000Z';

  it('C3: cột "Đóng / trả" render giờ VN từ customerAppointmentAt (Z instant)', () => {
    renderView([makeLine({ id: 31, ordinal: 1, customerAppointmentAt: instant })]);
    expect(screen.getByText('30/10 14:30')).toBeTruthy();
    expect(screen.queryByText('30/10 07:30')).toBeNull();
  });

  it('C4: dòng "Lịch cont" render giờ VN từ group.at (Z instant)', () => {
    renderView([], {
      appointmentGroups: [{ at: instant, factoryName: 'Sunrise', containerSummary: '1x20DC' }],
    } as Partial<ShipmentCusWorkspaceListItem>);
    expect(screen.getByText(/30\/10 14:30 · Sunrise · 1x20DC/)).toBeTruthy();
    expect(screen.queryByText(/07:30/)).toBeNull();
  });
});

// SIL-610 (id 713): lô lẻ cũ không có instant lưu trữ — chi tiết lô ("Ngày giờ
// đóng/trả") cũng phải đọc instant derived từ chuyến trước khi rơi về ngày
// thuần, cùng chuỗi với ô Tổng quan.
describe('CusLotView — SIL-610 giờ derived từ chuyến cho lô cũ', () => {
  it('C6: "Ngày giờ đóng/trả" render derivedScheduleAt khi cả closingAt/plannedReturnAt trống', () => {
    renderView([], {
      cargoMode: 'LCL',
      direction: 'IMPORT',
      transportDate: '2026-10-29',
      derivedScheduleAt: '2026-10-29T02:30:00.000Z',
    } as Partial<ShipmentCusWorkspaceListItem>);
    expect(screen.getByText('29/10/2026 09:30')).toBeTruthy();
  });

  it('C6: không có derived thì vẫn ngày thuần, không bịa 00:00', () => {
    renderView([], {
      cargoMode: 'LCL',
      direction: 'IMPORT',
      transportDate: '2026-10-29',
    } as Partial<ShipmentCusWorkspaceListItem>);
    expect(screen.getByText('29/10/2026')).toBeTruthy();
    expect(screen.queryByText(/29\/10\/2026 00:00/)).toBeNull();
  });
});
