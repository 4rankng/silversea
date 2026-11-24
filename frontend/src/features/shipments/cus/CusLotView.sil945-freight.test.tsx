// SIL-945 (KB Ch.3 §3.1.7 / Ch.10 §10.1.4) — the three freight column groups
// on the lot-detail drawer's container table (the surface the QA FAIL named:
// the /shipments-detail drawer, not the workboard). Pins the consumer-visible
// render: the group band over four tracks each, the two-line money cell
// (amount above, invoice number below), '—' (never a fabricated 0) for
// chưa-xác-định money, and the amount-only Tổng cước track.
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { CusLotView } from './CusLotView';

vi.mock('../../../hooks/usePopoverPosition', () => ({
  usePopoverPosition: () => ({ top: 10, left: 10, maxHeight: null }),
}));

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
      containerNumber: { mode: 'DIRECT', reason: 'writable' },
      containerTypeId: { mode: 'DIRECT', reason: 'writable' },
      cargoWeightKg: { mode: 'DIRECT', reason: 'writable' },
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

function makeItem(): ShipmentCusWorkspaceListItem {
  return {
    id: 78,
    customerName: 'Khách SIL-945',
    cargoMode: 'FCL',
    isCombined: false,
    declarationNumbers: [],
    billOrBookNumber: 'BILL-945',
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
  } as unknown as ShipmentCusWorkspaceListItem;
}

function renderView(lines: ShipmentCusWorkspaceContainerLine[]) {
  return render(
    <CusLotView
      item={makeItem()}
      detail={{ summary: makeItem(), containers: lines, selectors: { containerTypes: [] } } as unknown as ShipmentCusWorkspaceDetail}
      loading={false}
      error={undefined}
      onRetry={() => {}}
    />,
  );
}

const freightGroups = {
  outbound: {
    transport: { amount: '3952000', invoiceNumbers: ['HD-1'] },
    handling: { amount: '250000' },
    incidental: { amount: null },
    total: '4202000',
  },
  inbound: {
    transport: { amount: '2000000' },
    handling: { amount: '200000', invoiceNumbers: ['HD-1', 'HD-2'] },
    incidental: { amount: '50000', invoiceNumbers: ['HD-2'] },
    total: '2250000',
  },
  chiHo: {
    csht: { amount: '300000', invoiceNumbers: ['HD-C1'] },
    lift: { amount: '200000' },
    drop: { amount: null },
    other: { amount: '90000', invoiceNumbers: ['HD-C4'] },
  },
};

describe('SIL-945 — nhóm cột cước trên drawer Chi tiết lô', () => {
  it('renders the three group bands over four tracks each in KB §3.1.7 order', () => {
    renderView([makeLine({ id: 21, ordinal: 1, freightGroups })]);
    for (const band of ['Cước đầu ra', 'Cước đầu vào', 'Phí chi hộ']) {
      expect(screen.getByRole('columnheader', { name: band })).toBeTruthy();
    }
    // 4 tracks per group: Vận chuyển / Làm hàng / Phát sinh / Tổng cước twice
    // (outbound + inbound); CSHT · Nâng · Hạ · Khác once. The ten identity
    // columns keep their names.
    for (const track of ['Vận chuyển', 'Làm hàng', 'Phát sinh', 'Tổng cước']) {
      expect(screen.getAllByRole('columnheader', { name: track })).toHaveLength(2);
    }
    for (const track of ['CSHT', 'Nâng', 'Hạ', 'Khác']) {
      expect(screen.getAllByRole('columnheader', { name: track })).toHaveLength(1);
    }
    for (const column of ['STT', 'Số container', 'Số tờ khai', 'Nhà máy', 'Tuyến đường', 'Nhà xe / BKS', 'Cảng nâng', 'Cảng hạ', 'Đóng / trả', 'Trạng thái']) {
      expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
    }
  });

  it('the money cell is two lines: amount above, invoice number below; Tổng cước is amount-only', () => {
    renderView([makeLine({ id: 21, ordinal: 1, freightGroups })]);
    const transport = document.querySelector('td[data-label="Cước đầu ra · Vận chuyển"]') as HTMLElement;
    expect(within(transport).getByText('3.952.000')).toBeTruthy();
    expect(within(transport).getByText('HĐ: HD-1')).toBeTruthy();
    const total = document.querySelector('td[data-label="Cước đầu ra · Tổng cước"]') as HTMLElement;
    expect(within(total).getByText('4.202.000')).toBeTruthy();
    expect(total.textContent).not.toContain('HĐ:');
    // Chi hộ keeps its invoice lines on the cells that carry them.
    const csht = document.querySelector('td[data-label="Phí chi hộ · CSHT"]') as HTMLElement;
    expect(within(csht).getByText('300.000')).toBeTruthy();
    expect(within(csht).getByText('HĐ: HD-C1')).toBeTruthy();
  });

  it('chưa-xác-định money renders — never a fabricated 0', () => {
    renderView([makeLine({ id: 21, ordinal: 1, freightGroups })]);
    const incidental = document.querySelector('td[data-label="Cước đầu ra · Phát sinh"]') as HTMLElement;
    expect(incidental.textContent).toBe('—');
    const drop = document.querySelector('td[data-label="Phí chi hộ · Hạ"]') as HTMLElement;
    expect(drop.textContent).toBe('—');
  });

  it('a line whose wire predates freightGroups renders — on every track, never zeros', () => {
    renderView([makeLine({ id: 22, ordinal: 1 })]);
    for (const label of ['Cước đầu ra · Vận chuyển', 'Cước đầu vào · Tổng cước', 'Phí chi hộ · Khác']) {
      const cell = document.querySelector(`td[data-label="${label}"]`) as HTMLElement;
      expect(cell.textContent).toBe('—');
    }
  });
});
