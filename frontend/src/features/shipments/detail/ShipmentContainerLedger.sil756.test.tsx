import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { ShipmentContainerLedger } from './ShipmentContainerLedger';

const access = (mode: 'DIRECT' | 'REQUEST' | 'READ_ONLY' = 'DIRECT') => ({ mode, reason: 'trường kiểm thử' });

const makeRow = (containerNumber: string, declarationNumber: string) => ({
  id: 101,
  shipmentId: 202,
  shipmentVersion: 1,
  ordinal: 1,
  customerId: 1,
  customerName: 'Long Minh',
  factoryName: 'ASKEY-XƯỞNG 2',
  routeName: 'Hải Phòng - Bắc Ninh',
  billOrBookNumber: 'EGLV149607019409',
  declarationNumber,
  shippingLineName: 'Evergreen',
  isCombined: false,
  classification: 'SINGLE',
  direction: 'IMPORT',
  containerNumber,
  containerTypeLabel: "40'HC",
  dispatchStatus: 'AWAITING_VEHICLE',
  carrierName: 'SilverSea',
  carrierType: null,
  plateNumber: null,
  actualTruckNo: null,
  billingTruckNo: null,
  revVehicleClassCode: null,
  costVehicleClassCode: null,
  liftSite: 'Cảng Đình Vũ',
  dropoffSite: 'KCN Quế Võ',
  transportDate: '2026-11-09',
  closingAt: null,
  plannedReturnAt: null,
  customerAppointmentAt: '2026-11-09T08:00:00.000Z',
  customerNotes: null,
  operationalNotes: null,
  raw: { containerNumber, containerTypeId: 2, cargoWeightKg: null, cargoVolumeCbm: null },
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
}) as unknown as ShipmentCusContainerFlatRow;

function renderLedger(row: ShipmentCusContainerFlatRow) {
  return render(
    <ShipmentContainerLedger
      rows={[row]}
      totalContainers={1}
      today="2026-11-09"
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
      onCopyDeclaration={vi.fn(async () => 0)}
    />,
    { wrapper: MemoryRouter },
  );
}

describe('SIL-756: nowrap + overflow-x: auto (scrollable, NO ellipsis) + tooltip for container serial & declaration numbers', () => {
  it('renders exact test strings "108590773650" (all 12 digits) and "QACU200050" with title tooltip and zero ellipsis truncation', () => {
    const row = makeRow('QACU200050', '108590773650');
    const { container } = renderLedger(row);

    // 1. Container serial 'QACU200050' — full string readable in cell
    const contCell = container.querySelector('td[data-label="Thông số container"] .shipment-container-ledger__code');
    expect(contCell).not.toBeNull();
    expect(contCell?.textContent).toBe('QACU200050');
    expect(contCell?.textContent).not.toContain('…');
    expect(contCell?.textContent).not.toContain('...');
    expect(contCell?.getAttribute('title')).toBe('QACU200050');

    // 2. Pure digits declaration '108590773650' — full 12 digits readable in cell without ellipsis truncation
    const declCell = container.querySelector('td[data-label="Số tờ khai"] .shipment-container-ledger__code');
    expect(declCell).not.toBeNull();
    expect(declCell?.textContent).toBe('108590773650');
    expect(declCell?.textContent).not.toContain('…');
    expect(declCell?.textContent).not.toContain('...');
    expect(declCell?.textContent?.length).toBe(12);
    expect(declCell?.getAttribute('title')).toBe('108590773650');
  });

  it('renders alphanumeric declaration "TK1108R002" with title tooltip and zero ellipsis truncation', () => {
    const row = makeRow('QACU200050', 'TK1108R002');
    const { container } = renderLedger(row);

    const declCell = container.querySelector('td[data-label="Số tờ khai"] .shipment-container-ledger__code');
    expect(declCell).not.toBeNull();
    expect(declCell?.textContent).toBe('TK1108R002');
    expect(declCell?.textContent).not.toContain('…');
    expect(declCell?.textContent).not.toContain('...');
    expect(declCell?.getAttribute('title')).toBe('TK1108R002');
  });

  it('CSS rules enforce nowrap, overflow-x: auto (scrollable cell), and NO ellipsis truncation on identifier codes', () => {
    const shipmentCss = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentContainersPage.css'), 'utf8');
    const dispatchCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

    // ShipmentContainersPage.css identifier rule:
    const shipmentDeclRule = shipmentCss.match(
      /\.shipment-container-ledger td\[data-label="Số tờ khai"\] \.shipment-container-ledger__code[\s\S]*?\{([\s\S]*?)\}/
    )?.[1];
    expect(shipmentDeclRule).toBeDefined();
    expect(shipmentDeclRule).toMatch(/white-space:\s*nowrap\s*!important/);
    expect(shipmentDeclRule).toMatch(/overflow-x:\s*auto\s*!important/);
    expect(shipmentDeclRule).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(shipmentDeclRule).toMatch(/word-break:\s*normal/);

    // Multiline span excludes .shipment-container-ledger__code so it never inherits break-word:
    expect(shipmentCss).toMatch(/:not\(\.shipment-container-ledger__code\)/);

    // DetailedPlanGrid.css declaration & container rules:
    const dispatchDeclRule = dispatchCss.match(/\.detailed-plan-grid__decl-value\s*\{([\s\S]*?)\}/)?.[1];
    expect(dispatchDeclRule).toBeDefined();
    expect(dispatchDeclRule).toMatch(/white-space:\s*nowrap/);
    expect(dispatchDeclRule).toMatch(/overflow-x:\s*auto/);
    expect(dispatchDeclRule).not.toMatch(/text-overflow:\s*ellipsis/);

    const dispatchContRule = dispatchCss.match(/\.detailed-plan-grid__cell--container \.ops-container-line\s*\{([\s\S]*?)\}/)?.[1];
    expect(dispatchContRule).toBeDefined();
    expect(dispatchContRule).toMatch(/white-space:\s*nowrap/);
    expect(dispatchContRule).toMatch(/overflow-x:\s*auto/);
    expect(dispatchContRule).not.toMatch(/text-overflow:\s*ellipsis/);
  });
});
