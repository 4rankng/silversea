// Regression lock for the detail workboard's bulk appointment copy — the
// customer case (2026-09-18): a multi-container lot delivering on one day had
// to be scheduled one popover + one save per container. The load-bearing parts
// are behavioral: writes go only to the caller's empty same-lot targets, the
// shipment version is threaded from each response so a lot-wide batch cannot
// 409 against itself, a mid-batch failure stops and reports how far it got,
// and the open edit session wins over a competing batch.
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../../../api/shipmentClient', () => ({
  listCusShipmentContainers,
  getCusShipmentWorkspaceDetail,
  updateShipment,
  updateCusShipmentContainerLine,
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
  dispatchStatus: '',
  informationStatus: '',
  sortKey: null,
  sortDir: 'asc',
};

const flatRow = (overrides: Partial<ShipmentCusContainerFlatRow> = {}): ShipmentCusContainerFlatRow => ({
  id: 11,
  shipmentId: 5,
  shipmentVersion: 2,
  ordinal: 1,
  customerId: 1,
  customerName: 'TD Test',
  factoryName: null,
  routeName: null,
  billOrBookNumber: null,
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

const detail = (containers: Partial<ShipmentCusWorkspaceContainerLine>[] = [line()], version = 2): ShipmentCusWorkspaceDetail => ({
  summary: {
    id: 5,
    version,
    cargoMode: 'FCL',
    operational: { transportDateEditable: true },
    raw: {
      factoryName: null, routeId: null, deliveryLocation: null,
      blNumber: null, bookingRef: null, tradeDirection: 'IMPORT', shippingLineName: null,
    },
    fieldAccess: {},
  },
  containers: containers.map((override) => line(override)),
  selectors: { routes: [], containerTypes: [], operationalSites: [], externalCarriers: [], carrierVehicles: [], ports: [] },
} as unknown as ShipmentCusWorkspaceDetail);

const SOURCE_AT = '2026-09-19T02:00:00.000Z';

/** The slice of the detail hook this sheet drives — declared here so the test
 *  never publishes the hook's shape through `ReturnType<typeof …>`. */
interface CopyAppointmentApi {
  copyingAppointment: boolean;
  editNotice: string | null;
  error: string | null;
  activeEdit: unknown;
  startEdit: (row: ShipmentCusContainerFlatRow, mode: 'schedule', triggerId: string) => Promise<void>;
  copyAppointmentToEmpty: (source: ShipmentCusContainerFlatRow) => Promise<number>;
}

function Probe({
  rows,
  onReady,
}: {
  rows: ShipmentCusContainerFlatRow[];
  onReady: (api: CopyAppointmentApi) => void;
}) {
  const api = useCusDetail(baseParams);
  onReady(api);
  return (
    <div>
      <span data-testid="notice">{api.editNotice ?? ''}</span>
      <span data-testid="error">{api.error ?? ''}</span>
      <span data-testid="copying">{api.copyingAppointment ? 'yes' : 'no'}</span>
      <button type="button" onClick={() => void api.startEdit(rows[0], 'schedule', 'trigger-1')}>start</button>
      <span data-testid="editing">{api.activeEdit != null ? 'yes' : 'no'}</span>
    </div>
  );
}

async function setup(rows: ShipmentCusContainerFlatRow[], lot: ShipmentCusWorkspaceDetail = detail()) {
  listCusShipmentContainers.mockResolvedValue({ items: rows, total: rows.length, totalPages: 1 } as unknown as ShipmentCusContainerFlatResponse);
  getCusShipmentWorkspaceDetail.mockResolvedValue(lot);
  updateShipment.mockResolvedValue({ version: 3 });
  updateCusShipmentContainerLine.mockResolvedValue({ line: { shipmentVersion: 3 } });
  let api: CopyAppointmentApi | null = null;
  const view = render(<Probe rows={rows} onReady={(value) => { api = value; }} />);
  await waitFor(() => expect(listCusShipmentContainers).toHaveBeenCalled());
  return { api: () => api!, view };
}

describe('useCusDetail copyAppointmentToEmpty — bulk appointment entry', () => {
  afterEach(() => vi.clearAllMocks());

  it('writes one versioned container command per empty container of the lot, threading each returned version', async () => {
    const source = flatRow({ id: 11, customerAppointmentAt: SOURCE_AT });
    const second = flatRow({ id: 12, ordinal: 2, containerNumber: 'TD700011' });
    const third = flatRow({ id: 13, ordinal: 3, containerNumber: 'TD700012' });
    const foreign = flatRow({ id: 21, shipmentId: 9, ordinal: 1, containerNumber: 'ZZ000001' });
    // The lot read is the target authority: a dated sibling and a read-only
    // sibling must never be written, and the version chain starts from the
    // freshly read summary — not from the possibly stale page row.
    const lot = detail([
      { id: 11, customerAppointmentAt: SOURCE_AT },
      { id: 12, ordinal: 2, customerAppointmentAt: null },
      { id: 13, ordinal: 3, customerAppointmentAt: null },
      { id: 14, ordinal: 4, customerAppointmentAt: '2026-09-20T01:00:00.000Z' },
      { id: 15, ordinal: 5, customerAppointmentAt: null, permissions: { customerAppointmentEditable: false } as unknown as ShipmentCusWorkspaceContainerLine['permissions'] },
    ], 7);
    updateCusShipmentContainerLine
      .mockResolvedValueOnce({ line: { shipmentVersion: 8 } })
      .mockResolvedValueOnce({ line: { shipmentVersion: 9 } });
    const { api } = await setup([source, second, third, foreign], lot);

    let copied = 0;
    await act(async () => {
      copied = await api().copyAppointmentToEmpty(source);
    });

    expect(copied).toBe(2);
    expect(updateCusShipmentContainerLine).toHaveBeenCalledTimes(2);
    expect(updateCusShipmentContainerLine).toHaveBeenNthCalledWith(1, 5, 12, {
      expectedShipmentVersion: 7,
      customerAppointmentAt: SOURCE_AT,
    }, expect.any(String));
    // The second write must carry the version the first response handed back,
    // not the stale page version — otherwise the batch 409s against itself.
    expect(updateCusShipmentContainerLine).toHaveBeenNthCalledWith(2, 5, 13, {
      expectedShipmentVersion: 8,
      customerAppointmentAt: SOURCE_AT,
    }, expect.any(String));
    // Rows are refetched so the page shows the committed datetimes, and the
    // copy counts only what the caller asked for (never the other lot's row).
    expect(listCusShipmentContainers).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(document.querySelector('[data-testid="notice"]')?.textContent)
      .toBe('Đã copy ngày giờ đóng trả sang 2 container chưa có lịch.'));
    expect(document.querySelector('[data-testid="copying"]')?.textContent).toBe('no');
  });

  it('stops at the first conflict, reloads the page and reports how far the copy got', async () => {
    const source = flatRow({ id: 11, customerAppointmentAt: SOURCE_AT });
    const second = flatRow({ id: 12, ordinal: 2 });
    const third = flatRow({ id: 13, ordinal: 3 });
    const lot = detail([
      { id: 11, customerAppointmentAt: SOURCE_AT },
      { id: 12, ordinal: 2, customerAppointmentAt: null },
      { id: 13, ordinal: 3, customerAppointmentAt: null },
    ], 2);
    updateCusShipmentContainerLine
      .mockResolvedValueOnce({ line: { shipmentVersion: 3 } })
      .mockRejectedValueOnce(new ApiError(409, null, 'Lô hàng vừa thay đổi, vui lòng tải lại.'));
    const { api } = await setup([source, second, third], lot);

    let copied = 0;
    await act(async () => {
      copied = await api().copyAppointmentToEmpty(source);
    });

    expect(copied).toBe(1);
    expect(listCusShipmentContainers).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(document.querySelector('[data-testid="error"]')?.textContent)
      .toContain('sau 1/2 container'));
    expect(document.querySelector('[data-testid="notice"]')?.textContent).toBe('');
    expect(document.querySelector('[data-testid="copying"]')?.textContent).toBe('no');
  });

  it('does nothing when the source has no appointment, and says so when the lot has no empty container left', async () => {
    const undated = flatRow({ id: 11 });
    const empty = flatRow({ id: 12, ordinal: 2 });
    const fullyDatedLot = detail([{ id: 11, customerAppointmentAt: SOURCE_AT }], 2);
    const { api } = await setup([undated, empty], fullyDatedLot);

    let withoutAppointment = 0;
    let withoutTargets = 0;
    await act(async () => {
      withoutAppointment = await api().copyAppointmentToEmpty(undated);
      withoutTargets = await api().copyAppointmentToEmpty(flatRow({ id: 11, customerAppointmentAt: SOURCE_AT }));
    });

    expect(withoutAppointment).toBe(0);
    expect(withoutTargets).toBe(0);
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="notice"]')?.textContent).toBe('Lô này không còn container nào cần copy giờ hẹn.');
  });

  it('refuses to start a batch while an edit session is open', async () => {
    const source = flatRow({ id: 11, customerAppointmentAt: SOURCE_AT });
    const second = flatRow({ id: 12, ordinal: 2 });
    const { api } = await setup([source, second]);
    await act(async () => { (document.querySelector('button') as HTMLButtonElement).click(); });
    await waitFor(() => expect(document.querySelector('[data-testid="editing"]')?.textContent).toBe('yes'));

    await expect(api().copyAppointmentToEmpty(source)).rejects.toThrow('Lưu hoặc hủy dòng đó trước khi copy');
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
    expect(listCusShipmentContainers).toHaveBeenCalledTimes(1);
  });
});
