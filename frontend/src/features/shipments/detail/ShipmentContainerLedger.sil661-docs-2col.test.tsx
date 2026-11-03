/**
 * SIL-661 — the «Chỉnh sửa chứng từ và hãng tàu» dialog lays out in a
 * 2-column desktop grid and drops the two per-container guidance lines.
 * Pins (per the design lock — DOM structure, never CSS text):
 *   1. the documents grid carries the `--docs` modifier on the SAME shared
 *      grid element and the five field labels are its DIRECT children in the
 *      FB-113 + SIL-659 order — 5 fields = 3 rows (2/2/1), the 5th (Số cont)
      owning the left cell of the last row with the right cell left EMPTY
 *      (no fake filler element);
 *   2. both guidance strings are gone from the dialog everywhere;
 *   3. the LCL persistence line (SIL-503, a separate ruling) still renders
 *      for lot-level rows only.
 * Layout law lives in ShipmentContainersPage.css (`--docs` modifier); the
 * rendered 2-column result is proven by the browser-drive evidence under qa/.
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { ShipmentContainerLedger, type ShipmentDocumentsDraft } from './ShipmentContainerLedger';

const { updateLclTruckMock } = vi.hoisted(() => ({ updateLclTruckMock: vi.fn(async () => ({ updatedShipmentIds: [] })) }));
vi.mock('../../../api/dispatchPlanningClient', () => ({
  updateLclTruck: updateLclTruckMock,
  listDispatchFleetResources: vi.fn(async () => ({ items: [] })),
}));

const access = (mode: 'DIRECT' | 'READ_ONLY' = 'DIRECT', reason = 'trường kiểm thử') => ({ mode, reason } as { mode: 'DIRECT' | 'READ_ONLY'; reason: string });

const CONT_NUMBER = 'MSKU6590002';

const row = (overrides: Partial<ShipmentCusContainerFlatRow> = {}) => ({
  id: 11,
  shipmentId: 5,
  shipmentVersion: 3,
  ordinal: 1,
  customerId: 1,
  customerName: 'LOG COM',
  factoryName: null,
  routeName: null,
  billOrBookNumber: 'EGLV149607019409',
  declarationNumber: null,
  shippingLineName: 'Evergreen',
  isCombined: false,
  classification: 'SINGLE',
  direction: 'IMPORT',
  containerNumber: CONT_NUMBER,
  containerTypeLabel: '40HC',
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
  transportDate: '2026-11-03',
  closingAt: null,
  plannedReturnAt: null,
  customerAppointmentAt: null,
  customerNotes: null,
  operationalNotes: null,
  raw: { containerNumber: CONT_NUMBER, containerTypeId: 1, cargoWeightKg: '24000', cargoVolumeCbm: '33.0' },
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
  dropoffSiteEditable: false,
  routeEditable: false,
  customerAppointmentEditable: false,
  scheduleEditable: false,
  isLotLevel: undefined,
  ...overrides,
}) as ShipmentCusContainerFlatRow;

const line = (overrides: Partial<ShipmentCusWorkspaceContainerLine> = {}): ShipmentCusWorkspaceContainerLine => ({
  id: 11,
  ordinal: 1,
  operationalSiteId: null,
  containerNumber: CONT_NUMBER,
  declarationNumber: null,
  containerTypeId: 1,
  containerTypeLabel: '40HC',
  routeId: null,
  routeName: null,
  dispatchStatus: 'AWAITING_VEHICLE',
  tripId: null,
  tripStatus: null,
  tripDepartureDate: null,
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
  raw: { containerNumber: CONT_NUMBER, containerTypeId: 1, cargoWeightKg: '24000', cargoVolumeCbm: '33.0', routeId: null },
  fieldAccess: {
    operationalSiteId: access(),
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
    carrierEditable: false,
    plateEditable: false,
    containerTypeEditable: false,
    routeEditable: false,
    liftSiteEditable: false,
    dropoffSiteEditable: false,
    customerAppointmentEditable: false,
  },
  shipmentVersion: 3,
  relatedTripVersion: null,
  ...overrides,
});

const detail = (): ShipmentCusWorkspaceDetail => ({
  summary: {
    id: 5,
    version: 3,
    cargoMode: 'FCL',
    operational: { transportDateEditable: false },
    raw: {
      factoryName: null, routeId: null, deliveryLocation: null,
      blNumber: 'EGLV149607019409', bookingRef: null, tradeDirection: 'IMPORT',
      shippingLineName: 'Evergreen', declarationNumber: null,
    },
    fieldAccess: {
      customerId: access(), factoryName: access(), routeId: access(), deliveryLocation: access(),
      blNumber: access(), bookingRef: access(), declarationNumber: access(),
      tradeDirection: access(), shippingLineName: access(),
    },
  },
  containers: [line()],
  selectors: { routes: [], containerTypes: [], operationalSites: [], externalCarriers: [], carrierVehicles: [], ports: [] },
} as unknown as ShipmentCusWorkspaceDetail);

function documentsSession({
  row: rowOverride,
  line: lineOverride,
}: {
  row?: ShipmentCusContainerFlatRow;
  line?: ShipmentCusWorkspaceContainerLine;
} = {}) {
  const activeRow = rowOverride ?? row();
  const activeLine = lineOverride ?? line();
  const onSaveDocuments = vi.fn(async (_row: ShipmentCusContainerFlatRow, _draft: ShipmentDocumentsDraft) => {});
  render(
    <MemoryRouter>
      <ShipmentContainerLedger
        rows={[activeRow]}
        totalContainers={1}
        today="2026-11-03"
        sort={null}
        onSortChange={vi.fn()}
        activeEdit={{ row: activeRow, detail: detail(), line: activeLine, mode: 'documents' }}
        editLoadingRowId={null}
        editError={null}
        onStartEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onSaveRoute={vi.fn(async () => {})}
        onSaveVehicle={vi.fn(async () => {})}
        onSaveSchedule={vi.fn(async () => {})}
        onSaveNotes={vi.fn(async () => {})}
        onSaveIdentity={vi.fn(async () => {})}
        onSaveDocuments={onSaveDocuments}
        onSaveContainer={vi.fn(async () => {})}
      />
    </MemoryRouter>,
  );
  return { onSaveDocuments };
}

const docsGrid = () => document.querySelector('.shipment-container-ledger__editor-grid--docs') as HTMLElement;
const toKhaiContainerVariant = /Số tờ khai lưu theo từng container của lô — mỗi container giữ số tờ khai riêng/;
const soContVariant = /Số cont lưu theo từng container — đồng bộ với ô THÔNG SỐ CONTAINER/;

describe('SIL-661 — dialog «Chỉnh sửa chứng từ và hãng tàu» bố cục 2 cột, bỏ 2 dòng hướng dẫn', () => {
  it('pins the 2-column grid as DOM structure: 5 field labels are the DIRECT children of one --docs grid, no filler cell', () => {
    documentsSession();
    const grid = docsGrid();
    expect(grid).toBeTruthy();
    // The modifier rides the SAME shared grid element — never a second grid.
    expect(grid.classList.contains('shipment-container-ledger__editor-grid')).toBe(true);
    // 5 fields = 3 rows (2/2/1) in the FB-113 + SIL-659 order…
    expect(Array.from(grid.querySelectorAll(':scope > label > span')).map((el) => el.textContent))
      .toEqual(['Số Bill', 'Số tờ khai', 'Nhập / Xuất', 'Hãng tàu', 'Số cont']);
    // …every direct child is a field label — the 5th row's right cell is EMPTY
    // grid space, never a fake filler element.
    expect(grid.children.length).toBe(5);
    expect(Array.from(grid.children).every((el) => el.tagName === 'LABEL')).toBe(true);
  });

  it('both per-container guidance lines are gone from the dialog (grep law: absent everywhere)', () => {
    documentsSession();
    expect(docsGrid().textContent).not.toMatch(toKhaiContainerVariant);
    expect(docsGrid().textContent).not.toMatch(soContVariant);
  });

  it('LCL lot rows keep the SIL-503 lot-level line and never show the container variants', () => {
    const lotRow = row({ id: -71, isLotLevel: true, containerNumber: null, raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null } });
    const pseudoLine = line({ id: -71, containerNumber: null, raw: { containerNumber: null, containerTypeId: null, cargoWeightKg: null, cargoVolumeCbm: null, routeId: null }, fieldAccess: { ...line().fieldAccess, containerNumber: access('READ_ONLY', 'Lô hàng lẻ không có dòng container.') } });
    documentsSession({ row: lotRow, line: pseudoLine });
    expect(docsGrid().textContent).toContain('Số tờ khai lưu theo LÔ hàng lẻ — nhập hoặc sửa số một lần cho cả lô.');
    expect(docsGrid().textContent).not.toMatch(toKhaiContainerVariant);
    expect(docsGrid().textContent).not.toMatch(soContVariant);
    // A lot owns no số cont — 4 fields stay as direct children of the grid.
    expect(docsGrid().children.length).toBe(5); // 4 labels + the lot-level guidance line
    expect(Array.from(docsGrid().children).filter((el) => el.tagName === 'LABEL').length).toBe(4);
  });
});
