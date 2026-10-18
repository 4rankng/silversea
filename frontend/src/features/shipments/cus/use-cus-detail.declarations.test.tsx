// Card 261013200312 (dev-lead ruling) + card 171026122100 (FB-109) —
// red-first wire-contract lock for PER-CONTAINER tờ khai writes from the CUS
// "Chi tiết lô hàng" documents editor. The number rides the container-line
// command (same version-guarded, idempotent endpoint the drawer uses); a
// non-empty save auto-copies onto the lot's still-EMPTY siblings INSIDE that
// same command (the response's `declarationSync` reports the written ids; a
// filled sibling is never overwritten), and the explicit copy button stays
// ONE server call for the whole lot (never a per-row loop). Pins: per-cont
// edit contract, auto-copy outcome wiring, copy propagation,
// single-container lot unchanged, 409 self-heal.
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ShipmentDocumentsSaveOutcome,
} from '../detail/ShipmentContainerLedger';
import type {
  ShipmentCusContainerFlatResponse,
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { ApiError } from '../../../lib/api';

const listCusShipmentContainers = vi.hoisted(() => vi.fn());
const getCusShipmentWorkspaceDetail = vi.hoisted(() => vi.fn());
const updateShipment = vi.hoisted(() => vi.fn());
const updateCusShipmentContainerLine = vi.hoisted(() => vi.fn());
const copyCusShipmentContainerDeclaration = vi.hoisted(() => vi.fn());

vi.mock('../../../api/shipmentClient', () => ({
  listCusShipmentContainers,
  getCusShipmentWorkspaceDetail,
  updateShipment,
  updateCusShipmentContainerLine,
  copyCusShipmentContainerDeclaration,
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
  containerNumber: 'TD700010',
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
  raw: { containerNumber: 'TD700010', containerTypeId: 1, cargoWeightKg: null, cargoVolumeCbm: null },
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
  containerNumber: 'TD700010',
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
  raw: { containerNumber: 'TD700010', containerTypeId: 1, cargoWeightKg: null, cargoVolumeCbm: null, routeId: null },
  fieldAccess: {},
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
  ...overrides,
} as ShipmentCusWorkspaceContainerLine);

/** A 3-cont FCL lot: cont 11 carries the number (post-copy shape), 12/13
 *  still empty — the divergence/copy fixtures build on this. */
const lotLines = (): ShipmentCusWorkspaceContainerLine[] => [
  line({ id: 11, declarationNumber: 'TK-SHARED-1' }),
  line({ id: 12, ordinal: 2, containerNumber: 'TD700012', declarationNumber: 'TK-SHARED-1' }),
  line({ id: 13, ordinal: 3, containerNumber: 'TD700013', declarationNumber: 'TK-SHARED-1' }),
];

const detail = (overrides: Partial<ShipmentCusWorkspaceDetail> = {}): ShipmentCusWorkspaceDetail => ({
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
  containers: lotLines(),
  selectors: { routes: [], containerTypes: [], operationalSites: [], externalCarriers: [], carrierVehicles: [], ports: [] },
  ...overrides,
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
  copyCusShipmentContainerDeclaration.mockResolvedValue({ updatedContainerIds: [12, 13], shipmentVersion: 3 });
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
  declarationNumber: 'TK-SHARED-1' as string | null,
};

describe('useCusDetail saveDocuments — per-container tờ khai wire contract (card 261013200312)', () => {
  afterEach(() => vi.clearAllMocks());

  it('a number-only edit rides the container-line command and skips the shipment PATCH entirely', async () => {
    const api = await setup(flatRow({ declarationNumber: 'TK-SHARED-1' }));
    await act(async () => {
      await api.saveDocuments(flatRow({ declarationNumber: 'TK-SHARED-1' }), { ...baseDraft, declarationNumber: 'TK-DIVERGED-11' });
    });
    expect(updateShipment).not.toHaveBeenCalled();
    expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1);
    expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(5, 11, {
      expectedShipmentVersion: 2,
      declarationNumber: 'TK-DIVERGED-11',
    }, expect.any(String));
  });

  it('a mixed save PATCHes the shipment first, then writes the number on the version the PATCH returned', async () => {
    const api = await setup(flatRow({ declarationNumber: 'TK-SHARED-1' }));
    const calls: string[] = [];
    updateShipment.mockImplementation(async () => { calls.push('PATCH'); return { version: 3 }; });
    updateCusShipmentContainerLine.mockImplementation(async () => { calls.push('LINE'); return {}; });
    await act(async () => {
      await api.saveDocuments(flatRow({ declarationNumber: 'TK-SHARED-1' }), {
        ...baseDraft,
        blNumber: 'EGLV999',
        declarationNumber: 'TK-NEW-11',
      });
    });
    expect(calls).toEqual(['PATCH', 'LINE']);
    expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(5, 11, {
      expectedShipmentVersion: 3,
      declarationNumber: 'TK-NEW-11',
    }, expect.any(String));
  });

  it('an unchanged number never issues the container write (no version bump for an echo)', async () => {
    const api = await setup(flatRow({ declarationNumber: 'TK-SHARED-1' }));
    await act(async () => {
      await api.saveDocuments(flatRow({ declarationNumber: 'TK-SHARED-1' }), baseDraft);
    });
    expect(updateShipment).not.toHaveBeenCalled();
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
    expect(listCusShipmentContainers).toHaveBeenCalledTimes(1);
  });

  it('clearing the number writes null on the container line', async () => {
    const api = await setup(flatRow({ declarationNumber: 'TK-SHARED-1' }));
    await act(async () => {
      await api.saveDocuments(flatRow({ declarationNumber: 'TK-SHARED-1' }), { ...baseDraft, declarationNumber: null });
    });
    expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(5, 11, {
      expectedShipmentVersion: 2,
      declarationNumber: null,
    }, expect.any(String));
  });

  it('copyDeclaration is ONE server call for the lot and refetches the rows afterwards', async () => {
    const api = await setup(flatRow({ id: 11, declarationNumber: 'TK-SHARED-1' }));
    expect(listCusShipmentContainers).toHaveBeenCalledTimes(1);
    let written = -1;
    await act(async () => {
      written = await api.copyDeclaration(flatRow({ id: 11, declarationNumber: 'TK-SHARED-1' }));
    });
    expect(copyCusShipmentContainerDeclaration).toHaveBeenCalledTimes(1);
    expect(copyCusShipmentContainerDeclaration).toHaveBeenCalledWith(5, 11, { expectedShipmentVersion: 2 }, expect.any(String));
    expect(written).toBe(2);
    await waitFor(() => expect(listCusShipmentContainers).toHaveBeenCalledTimes(2));
  });

  it('a 409 during the container write self-heals by refetching the workspace instead of throwing', async () => {
    const api = await setup(flatRow({ declarationNumber: 'TK-SHARED-1' }));
    updateCusShipmentContainerLine.mockRejectedValue(new ApiError(409, undefined, 'Lô hàng vừa thay đổi. Vui lòng tải lại trước khi cập nhật dòng container.'));
    await act(async () => {
      await api.saveDocuments(flatRow({ declarationNumber: 'TK-SHARED-1' }), { ...baseDraft, declarationNumber: 'TK-CLASH' });
    });
    await waitFor(() => expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledTimes(2));
    expect(listCusShipmentContainers).toHaveBeenCalledTimes(1);
  });

  it('a copy rejection (single-container lot / no empty siblings) surfaces the server error to the caller', async () => {
    const single = detail({ containers: [line({ id: 11, declarationNumber: 'TK-ONLY' })] });
    const api = await setup(flatRow({ id: 11, declarationNumber: 'TK-ONLY' }), single);
    copyCusShipmentContainerDeclaration.mockRejectedValue(new ApiError(409, undefined, 'Mọi container trong lô đã có số tờ khai.'));
    await expect(act(async () => {
      await api.copyDeclaration(flatRow({ id: 11, declarationNumber: 'TK-ONLY' }));
    })).rejects.toThrow('Mọi container trong lô đã có số tờ khai.');
    expect(listCusShipmentContainers).toHaveBeenCalledTimes(1);
  });
});

describe('useCusDetail saveDocuments — the save IS the auto-copy (card 171026122100 FB-109)', () => {
  afterEach(() => vi.clearAllMocks());

  /** An all-empty 3-cont lot: saving cont 11's number must reach 12/13 through
   *  the container-line command itself — the server copies onto the empty
   *  siblings in the same transaction and reports them as `declarationSync`. */
  const emptyLot = () => detail({
    containers: [
      line({ id: 11, declarationNumber: null }),
      line({ id: 12, ordinal: 2, containerNumber: 'TD700012', declarationNumber: null }),
      line({ id: 13, ordinal: 3, containerNumber: 'TD700013', declarationNumber: null }),
    ],
  });

  it('saving a non-empty number is ONE call — the server copies onto the empty siblings and the hook reports the written count', async () => {
    const api = await setup(flatRow({ declarationNumber: null }), emptyLot());
    updateCusShipmentContainerLine.mockResolvedValue({
      line: line({ shipmentVersion: 3, declarationNumber: 'TK-SYNC-1' }),
      declarationSync: { updatedContainerIds: [12, 13] },
    });
    let outcome: ShipmentDocumentsSaveOutcome | void | undefined;
    await act(async () => {
      outcome = await api.saveDocuments(flatRow({ declarationNumber: null }), { ...baseDraft, declarationNumber: 'TK-SYNC-1' });
    });
    expect(updateShipment).not.toHaveBeenCalled();
    expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1);
    // The FB-085 second call is gone by law — the save is the sync.
    expect(copyCusShipmentContainerDeclaration).not.toHaveBeenCalled();
    expect(outcome).toEqual({ sync: { written: 2 } });
    await waitFor(() => expect(listCusShipmentContainers).toHaveBeenCalledTimes(2));
  });

  it('a mixed save PATCHes the shipment, then writes the number ONCE — no copy call on any path', async () => {
    const api = await setup(flatRow({ declarationNumber: null, billOrBookNumber: 'EGLV123' }), emptyLot());
    const calls: string[] = [];
    updateShipment.mockImplementation(async () => { calls.push('PATCH'); return { version: 3 }; });
    updateCusShipmentContainerLine.mockImplementation(async () => {
      calls.push('LINE');
      return { line: line({ shipmentVersion: 4, declarationNumber: 'TK-SYNC-2' }), declarationSync: { updatedContainerIds: [12, 13] } };
    });
    await act(async () => {
      await api.saveDocuments(flatRow({ declarationNumber: null }), { ...baseDraft, blNumber: 'EGLV999', declarationNumber: 'TK-SYNC-2' });
    });
    expect(calls).toEqual(['PATCH', 'LINE']);
    expect(copyCusShipmentContainerDeclaration).not.toHaveBeenCalled();
  });

  it('a filled sibling changes nothing on the wire — one line call, and the server reports only the empty copy (FB-109 never-overwrite)', async () => {
    const mixedLot = detail({
      containers: [
        line({ id: 11, declarationNumber: null }),
        line({ id: 12, ordinal: 2, containerNumber: 'TD700012', declarationNumber: 'TK-OTHER' }),
        line({ id: 13, ordinal: 3, containerNumber: 'TD700013', declarationNumber: null }),
      ],
    });
    const api = await setup(flatRow({ declarationNumber: null }), mixedLot);
    updateCusShipmentContainerLine.mockResolvedValue({
      line: line({ shipmentVersion: 3, declarationNumber: 'TK-DIVERGE' }),
      // Real server shape under FB-109: only the still-empty 13 is written;
      // the filled 12 keeps its number and never appears in the report.
      declarationSync: { updatedContainerIds: [13] },
    });
    let outcome: ShipmentDocumentsSaveOutcome | void | undefined;
    await act(async () => {
      outcome = await api.saveDocuments(flatRow({ declarationNumber: null }), { ...baseDraft, declarationNumber: 'TK-DIVERGE' });
    });
    expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1);
    expect(copyCusShipmentContainerDeclaration).not.toHaveBeenCalled();
    expect(outcome).toEqual({ sync: { written: 1 } });
  });

  it('a clear stays local — no sync report even when the lot has siblings', async () => {
    const api = await setup(flatRow({ declarationNumber: 'TK-OLD' }), emptyLot());
    updateCusShipmentContainerLine.mockResolvedValue({ line: line({ shipmentVersion: 3, declarationNumber: null }) });
    let outcome: ShipmentDocumentsSaveOutcome | void | undefined;
    await act(async () => {
      outcome = await api.saveDocuments(flatRow({ declarationNumber: 'TK-OLD' }), { ...baseDraft, declarationNumber: null });
    });
    expect(copyCusShipmentContainerDeclaration).not.toHaveBeenCalled();
    expect(outcome).toBeUndefined();
  });

  it('a single-container lot reports no sync and never touches the copy endpoint', async () => {
    const single = detail({ containers: [line({ id: 11, declarationNumber: null })] });
    const api = await setup(flatRow({ declarationNumber: null }), single);
    updateCusShipmentContainerLine.mockResolvedValue({ line: line({ shipmentVersion: 3, declarationNumber: 'TK-ONLY-1' }) });
    let outcome: ShipmentDocumentsSaveOutcome | void | undefined;
    await act(async () => {
      outcome = await api.saveDocuments(flatRow({ declarationNumber: null }), { ...baseDraft, declarationNumber: 'TK-ONLY-1' });
    });
    expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(1);
    expect(copyCusShipmentContainerDeclaration).not.toHaveBeenCalled();
    expect(outcome).toBeUndefined();
  });

  it('an optimistic conflict on the save self-heals by refetching the workspace (the sync died with the save)', async () => {
    const api = await setup(flatRow({ declarationNumber: null }), emptyLot());
    updateCusShipmentContainerLine.mockRejectedValue(new ApiError(409, undefined, 'Lô hàng vừa thay đổi. Vui lòng tải lại trước khi cập nhật dòng container.'));
    await act(async () => {
      await api.saveDocuments(flatRow({ declarationNumber: null }), { ...baseDraft, declarationNumber: 'TK-CLASH' });
    });
    await waitFor(() => expect(getCusShipmentWorkspaceDetail).toHaveBeenCalledTimes(2));
    expect(listCusShipmentContainers).toHaveBeenCalledTimes(1);
  });

  it('a response without declarationSync (no empty sibling was written) reports nothing — no spurious toast', async () => {
    const api = await setup(flatRow({ declarationNumber: null }), emptyLot());
    updateCusShipmentContainerLine.mockResolvedValue({ line: line({ shipmentVersion: 3, declarationNumber: 'TK-ECHO' }) });
    let outcome: ShipmentDocumentsSaveOutcome | void | undefined;
    await act(async () => {
      outcome = await api.saveDocuments(flatRow({ declarationNumber: null }), { ...baseDraft, declarationNumber: 'TK-ECHO' });
    });
    expect(outcome).toBeUndefined();
    await waitFor(() => expect(listCusShipmentContainers).toHaveBeenCalledTimes(2));
  });
});
