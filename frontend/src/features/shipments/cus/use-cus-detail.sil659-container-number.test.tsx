// SIL-659 (id 766) — wire-contract lock for the documents dialog's SỐ CONT.
// The number rides the SAME container-line command the THÔNG SỐ CONTAINER
// cell uses (updateCusShipmentContainerLine → normalize + in-lot duplicate +
// the SIL-653 identity bridge on the server) — never the shipment PATCH, and
// never a second divergent record. Pins: cont-only save skips the PATCH, the
// number + tờ khai share ONE command when both change, the cont rides the
// version the PATCH returned on a mixed save, an echo issues nothing, a clear
// writes null, a READ_ONLY line access drops the write silently (the field
// was disabled in the editor), and a lot-level row can never carry one.
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ShipmentCusContainerFlatResponse,
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';

const listCusShipmentContainers = vi.hoisted(() => vi.fn());
const getCusShipmentWorkspaceDetail = vi.hoisted(() => vi.fn());
const updateShipment = vi.hoisted(() => vi.fn());
const updateCusShipmentContainerLine = vi.hoisted(() => vi.fn());
const copyCusShipmentContainerDeclaration = vi.hoisted(() => vi.fn());
const createShipmentDeclaration = vi.hoisted(() => vi.fn());
const updateShipmentDeclaration = vi.hoisted(() => vi.fn());

vi.mock('../../../api/shipmentClient', () => ({
  listCusShipmentContainers,
  getCusShipmentWorkspaceDetail,
  updateShipment,
  updateCusShipmentContainerLine,
  copyCusShipmentContainerDeclaration,
  createShipmentDeclaration,
  updateShipmentDeclaration,
}));

import { CUS_DETAIL_PAGE_SIZE } from './cusDetailModel';
import { useCusDetail, type CusDetailListParams } from './use-cus-detail';

const baseParams: CusDetailListParams = {
  page: 1,
  pageSize: CUS_DETAIL_PAGE_SIZE,
  searchSuffix: '',
  transportDateFrom: '',
  transportDateTo: '',
  customerId: 0,
  direction: '',
  dispatchStatus: '', informationStatus: '',
  sortKey: null,
  sortDir: 'asc',
};

const direct = { mode: 'DIRECT', reason: '' } as const;
const readOnly = (reason: string) => ({ mode: 'READ_ONLY', reason } as { mode: 'READ_ONLY'; reason: string });

const CONT = 'TD7000102';

const flatRow = (overrides: Partial<ShipmentCusContainerFlatRow> = {}): ShipmentCusContainerFlatRow => ({
  id: 11,
  shipmentId: 5,
  shipmentVersion: 2,
  ordinal: 1,
  customerId: 1,
  customerName: 'TD Test',
  factoryName: null,
  routeName: null,
  billOrBookNumber: 'EGLV123',
  declarationNumber: null,
  shippingLineName: null,
  isCombined: false,
  classification: 'SINGLE',
  direction: 'IMPORT',
  containerNumber: CONT,
  containerTypeLabel: null,
  dispatchStatus: 'AWAITING_VEHICLE',
  carrierName: null,
  plateNumber: null,
  liftSite: null,
  dropoffSite: null,
  transportDate: null,
  closingAt: null,
  plannedReturnAt: null,
  customerAppointmentAt: null,
  customerNotes: null,
  operationalNotes: null,
  raw: { containerNumber: CONT, containerTypeId: 1, cargoWeightKg: null, cargoVolumeCbm: null },
  fieldAccess: {},
  shipmentFieldAccess: {},
  informationStatus: 'MISSING',
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
} as ShipmentCusContainerFlatRow);

const line = (overrides: Partial<ShipmentCusWorkspaceContainerLine> = {}): ShipmentCusWorkspaceContainerLine => ({
  id: 11,
  ordinal: 1,
  containerNumber: CONT,
  declarationNumber: null,
  containerTypeId: 1,
  containerTypeLabel: null,
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
  raw: { containerNumber: CONT, containerTypeId: 1, cargoWeightKg: null, cargoVolumeCbm: null, routeId: null },
  fieldAccess: { containerNumber: direct },
  permissions: {
    carrierEditable: true,
    plateEditable: true,
    containerTypeEditable: true,
    routeEditable: true,
    liftSiteEditable: true,
    dropoffSiteEditable: true,
    customerAppointmentEditable: true,
  },
  shipmentVersion: 2,
  relatedTripVersion: null,
  operationalSiteId: null,
  tripDepartureDate: null,
  ...overrides,
} as ShipmentCusWorkspaceContainerLine);

const detail = (): ShipmentCusWorkspaceDetail => ({
  summary: {
    id: 5,
    version: 2,
    cargoMode: 'FCL',
    operational: { transportDateEditable: true },
    raw: {
      factoryName: null, routeId: null, deliveryLocation: null,
      blNumber: 'EGLV123', bookingRef: null, tradeDirection: 'IMPORT', shippingLineName: 'Evergreen',
    },
    fieldAccess: {
      blNumber: direct,
      bookingRef: direct,
      declarationNumber: direct,
      tradeDirection: direct,
      shippingLineName: direct,
    },
  },
  containers: [line()],
  selectors: { routes: [], containerTypes: [], operationalSites: [], externalCarriers: [], carrierVehicles: [], ports: [] },
} as unknown as ShipmentCusWorkspaceDetail);

function Probe({ row, onReady }: { row: ShipmentCusContainerFlatRow; onReady: (api: ReturnType<typeof useCusDetail>) => void }) {
  const api = useCusDetail(baseParams);
  onReady(api);
  return (
    <div>
      <button type="button" onClick={() => void api.startEdit(row, 'documents', 'trigger-1')}>start</button>
      <span data-testid="editing">{api.activeEdit != null ? 'yes' : 'no'}</span>
    </div>
  );
}

async function setup(row: ShipmentCusContainerFlatRow, workspace = detail()) {
  listCusShipmentContainers.mockResolvedValue({ items: [row], total: 1, totalPages: 1 } as unknown as ShipmentCusContainerFlatResponse);
  getCusShipmentWorkspaceDetail.mockResolvedValue(workspace);
  updateShipment.mockResolvedValue({ version: 3 });
  updateCusShipmentContainerLine.mockResolvedValue({});
  let api: ReturnType<typeof useCusDetail> | null = null;
  render(<Probe row={row} onReady={(value) => { api = value; }} />);
  await waitFor(() => expect(listCusShipmentContainers).toHaveBeenCalled());
  await act(async () => {
    (document.querySelector('button') as HTMLButtonElement).click();
  });
  await waitFor(() => expect(document.querySelector('[data-testid="editing"]')?.textContent).toBe('yes'));
  return api!;
}

const baseDraft = {
  blNumber: 'EGLV123' as string | null,
  bookingRef: null as string | null,
  tradeDirection: 'IMPORT' as 'IMPORT' | 'EXPORT' | null,
  shippingLineName: 'Evergreen' as string | null,
  declarationNumber: null as string | null,
};

describe('useCusDetail saveDocuments — Số cont rides the container-line command (SIL-659)', () => {
  afterEach(() => vi.clearAllMocks());

  it('a cont-only save rides the line command and skips the shipment PATCH entirely', async () => {
    const api = await setup(flatRow());
    await act(async () => {
      await api.saveDocuments(flatRow(), { ...baseDraft, containerNumber: 'TD7000103' });
    });
    expect(updateShipment).not.toHaveBeenCalled();
    expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1);
    expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(5, 11, {
      expectedShipmentVersion: 2,
      containerNumber: 'TD7000103',
    }, expect.any(String));
  });

  it('an echo (unchanged cont, nothing else) issues NO write at all', async () => {
    const api = await setup(flatRow());
    await act(async () => {
      await api.saveDocuments(flatRow(), { ...baseDraft, containerNumber: CONT });
    });
    expect(updateShipment).not.toHaveBeenCalled();
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
  });

  it('declaration + cont changed together share ONE container-line command', async () => {
    const api = await setup(flatRow());
    await act(async () => {
      await api.saveDocuments(flatRow(), { ...baseDraft, declarationNumber: 'TK-659', containerNumber: 'TD7000103' });
    });
    expect(updateShipment).not.toHaveBeenCalled();
    expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1);
    expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(5, 11, {
      expectedShipmentVersion: 2,
      declarationNumber: 'TK-659',
      containerNumber: 'TD7000103',
    }, expect.any(String));
  });

  it('a PATCH + cont save PATCHes first and the cont rides the version the PATCH returned', async () => {
    const api = await setup(flatRow());
    const calls: string[] = [];
    updateShipment.mockImplementation(async () => { calls.push('PATCH'); return { version: 3 }; });
    updateCusShipmentContainerLine.mockImplementation(async () => { calls.push('LINE'); return {}; });
    await act(async () => {
      await api.saveDocuments(flatRow(), { ...baseDraft, blNumber: 'EGLV999', containerNumber: 'TD7000103' });
    });
    expect(calls).toEqual(['PATCH', 'LINE']);
    expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(5, 11, {
      expectedShipmentVersion: 3,
      containerNumber: 'TD7000103',
    }, expect.any(String));
  });

  it('clearing the số cont writes null on the container line', async () => {
    const api = await setup(flatRow());
    await act(async () => {
      await api.saveDocuments(flatRow(), { ...baseDraft, containerNumber: null });
    });
    expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(5, 11, {
      expectedShipmentVersion: 2,
      containerNumber: null,
    }, expect.any(String));
  });

  it('a READ_ONLY containerNumber access drops the cont write (the editor had the field disabled)', async () => {
    const lockedLine = line({ fieldAccess: { ...line().fieldAccess, containerNumber: readOnly('Lô hàng đã khóa kế toán.') } });
    const api = await setup(flatRow(), {
      ...detail(),
      containers: [lockedLine],
    } as unknown as ShipmentCusWorkspaceDetail);
    await act(async () => {
      await api.saveDocuments(flatRow(), { ...baseDraft, containerNumber: 'TD7000103' });
    });
    expect(updateShipment).not.toHaveBeenCalled();
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
  });

  it('a lot-level row can never carry a cont: its draft number is ignored, lot write paths stay declaration-only', async () => {
    const lotRow = flatRow({ id: -5, isLotLevel: true, containerNumber: null });
    const pseudoLine = line({ id: -5, containerNumber: null, fieldAccess: { ...line().fieldAccess, containerNumber: readOnly('Lô hàng lẻ không có dòng container.') } });
    const api = await setup(lotRow, {
      ...detail(),
      summary: { ...detail().summary, raw: { ...detail().summary.raw, declarationNumber: null } },
      containers: [pseudoLine],
    } as unknown as ShipmentCusWorkspaceDetail);
    await act(async () => {
      // Defensive: the editor omits the field for lots — the model must ignore
      // a stray one rather than inventing a container write for a lot.
      await api.saveDocuments(lotRow, { ...baseDraft, containerNumber: 'TD7000103' });
    });
    expect(updateShipment).not.toHaveBeenCalled();
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
    expect(createShipmentDeclaration).not.toHaveBeenCalled();
    expect(updateShipmentDeclaration).not.toHaveBeenCalled();
  });
});
