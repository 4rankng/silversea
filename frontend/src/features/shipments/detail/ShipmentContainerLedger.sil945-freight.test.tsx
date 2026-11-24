/**
 * SIL-945 (KB Ch.3 §3.1.7 / Ch.10 §10.1.4) — the three freight column groups
 * on the Chi tiết lô hàng workboard. Pins the consumer-visible render: the
 * group band over four tracks each, the two-line money cell (amount above,
 * invoice number below), '—' (never a fabricated 0) for chưa-xác-định money,
 * and the group toggles hiding all four tracks of a group.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { ShipmentContainerLedger } from './ShipmentContainerLedger';

const access = (mode: 'DIRECT' | 'READ_ONLY' = 'DIRECT') => ({ mode, reason: 'trường kiểm thử' });

const row = (overrides: Partial<ShipmentCusContainerFlatRow> = {}) => ({
  id: 1,
  shipmentId: 1,
  shipmentVersion: 1,
  ordinal: 1,
  customerId: 1,
  customerName: 'Long Minh',
  factoryName: null,
  routeName: null,
  billOrBookNumber: 'EGLV149607019409',
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
  actualTruckNo: null,
  billingTruckNo: null,
  revVehicleClassCode: null,
  costVehicleClassCode: null,
  liftSite: null,
  dropoffSite: null,
  transportDate: '2026-09-10',
  closingAt: null,
  plannedReturnAt: null,
  customerAppointmentAt: null,
  customerNotes: null,
  operationalNotes: null,
  raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null },
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
  shipmentScheduleEditable: false,
  shipmentNotesEditable: false,
  carrierEditable: false,
  plateEditable: false,
  liftSiteEditable: false,
  dropoffEditable: false,
  routeEditable: false,
  customerAppointmentEditable: false,
  scheduleEditable: false,
  isLotLevel: true,
  ...overrides,
}) as ShipmentCusContainerFlatRow;

const freightRow = () => row({
  freightGroups: {
    outbound: {
      transport: { amount: '3995000', invoiceNumbers: ['HD-9'] },
      handling: { amount: '250000' },
      incidental: { amount: null },
      total: '4245000',
    },
    inbound: {
      transport: { amount: '2000000' },
      handling: { amount: '200000', invoiceNumbers: ['HD-9', 'HD-10'] },
      incidental: { amount: '50000', invoiceNumbers: ['HD-10'] },
      total: '2250000',
    },
    chiHo: {
      csht: { amount: '300000', invoiceNumbers: ['HD-C1'] },
      lift: { amount: '200000' },
      drop: { amount: null },
      other: { amount: '90000', invoiceNumbers: ['HD-C4'] },
    },
  },
});

function ledgerView(rows: ShipmentCusContainerFlatRow[]) {
  return render(
    <MemoryRouter>
      <ShipmentContainerLedger
        rows={rows}
        totalContainers={rows.length}
        today="2026-09-10"
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
      />
    </MemoryRouter>,
  );
}

describe('SIL-945 — nhóm cột cước trên bảng Chi tiết lô hàng', () => {
  it('renders the three group bands over four tracks each in KB §3.1.7 order', () => {
    ledgerView([freightRow()]);
    for (const band of ['Cước đầu ra', 'Cước đầu vào', 'Phí chi hộ']) {
      expect(screen.getByRole('columnheader', { name: band })).toBeTruthy();
    }
    // 4 tracks per group: the sub-headers Vận chuyển / Làm hàng / Phát sinh /
    // Tổng cước appear twice (outbound + inbound); CSHT · Nâng · Hạ · Khác once.
    for (const track of ['Vận chuyển', 'Làm hàng', 'Phát sinh', 'Tổng cước']) {
      expect(screen.getAllByRole('columnheader', { name: track })).toHaveLength(2);
    }
    for (const track of ['CSHT', 'Nâng', 'Hạ', 'Khác']) {
      expect(screen.getAllByRole('columnheader', { name: track })).toHaveLength(1);
    }
  });

  it('the money cell is two lines: amount above, invoice number below; Tổng cước is amount-only', () => {
    ledgerView([freightRow()]);
    const transport = document.querySelector('td[data-label="Cước đầu ra · Vận chuyển"]') as HTMLElement;
    expect(within(transport).getByText('3.995.000')).toBeTruthy();
    expect(within(transport).getByText('HĐ: HD-9')).toBeTruthy();
    const total = document.querySelector('td[data-label="Cước đầu ra · Tổng cước"]') as HTMLElement;
    expect(within(total).getByText('4.245.000')).toBeTruthy();
    expect(total.textContent).not.toContain('HĐ:');
  });

  it('chưa-xác-định money renders — never a fabricated 0; invoices stay on their own cell', () => {
    ledgerView([freightRow()]);
    const incidental = document.querySelector('td[data-label="Cước đầu ra · Phát sinh"]') as HTMLElement;
    expect(incidental.textContent).toBe('—');
    const drop = document.querySelector('td[data-label="Phí chi hộ · Hạ"]') as HTMLElement;
    expect(drop.textContent).toBe('—');
    const handlingIn = document.querySelector('td[data-label="Cước đầu vào · Làm hàng"]') as HTMLElement;
    expect(within(handlingIn).getByText('200.000')).toBeTruthy();
    expect(within(handlingIn).getByText('HĐ: HD-9')).toBeTruthy();
    expect(within(handlingIn).getByText('HĐ: HD-10')).toBeTruthy();
  });

});
