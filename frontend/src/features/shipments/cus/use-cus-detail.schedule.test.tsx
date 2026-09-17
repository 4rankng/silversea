// Regression lock for saveSchedule's dual-path schedule save — the load-
// bearing normalization is behavioral, not cosmetic: an appointment-less row
// drafts customerAppointmentAt null while formatVietnamDateTimeInput reads
// '', and without normalizing, the both-changed guard fires on EVERY
// transport-only save for appointment-less rows (the dead-end this card
// fixed). The matrix below pins each save path against mocked writers.
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

vi.mock('../../../api/shipmentClient', () => ({
  listCusShipmentContainers,
  getCusShipmentWorkspaceDetail,
  updateShipment,
  updateCusShipmentContainerLine,
}));

import { useCusDetail, type CusDetailListParams } from './use-cus-detail';

const baseParams: CusDetailListParams = {
  page: 1,
  searchSuffix: '',
  transportDateFrom: '',
  transportDateTo: '',
  customerId: 0,
  direction: '',
  dispatchStatus: '',
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

const detail = (lineOverride?: Partial<ShipmentCusWorkspaceContainerLine>): ShipmentCusWorkspaceDetail => ({
  summary: {
    id: 5,
    version: 2,
    cargoMode: 'LCL',
    operational: { transportDateEditable: true },
    raw: {
      factoryName: null, routeId: null, deliveryLocation: null,
      blNumber: null, bookingRef: null, tradeDirection: 'IMPORT', shippingLineName: null,
    },
    fieldAccess: {},
  },
  containers: [line(lineOverride)],
  selectors: { routes: [], containerTypes: [], operationalSites: [], externalCarriers: [], carrierVehicles: [], ports: [] },
} as unknown as ShipmentCusWorkspaceDetail);

function Probe({ row, onReady }: { row: ShipmentCusContainerFlatRow; onReady: (api: ReturnType<typeof useCusDetail>) => void }) {
  const api = useCusDetail(baseParams);
  onReady(api);
  return (
    <div>
      <button type="button" onClick={() => void api.startEdit(row, 'schedule', 'trigger-1')}>start</button>
      <span data-testid="editing">{api.activeEdit != null ? 'yes' : 'no'}</span>
    </div>
  );
}

async function setup(row: ShipmentCusContainerFlatRow, lineOverride?: Partial<ShipmentCusWorkspaceContainerLine>, workspace = detail(lineOverride)) {
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

describe('useCusDetail saveSchedule — non-FCL transport-date paths', () => {
  afterEach(() => vi.clearAllMocks());

  it('UI-CD-12 saves FCL identity through the versioned container command only', async () => {
    const row = flatRow();
    const workspace = detail();
    workspace.summary.cargoMode = 'FCL';
    workspace.containers[0].fieldAccess.operationalSiteId = { mode: 'DIRECT', reason: '' };
    const api = await setup(row, undefined, workspace);
    await act(async () => {
      await api.saveIdentity(row, { operationalSiteId: 18, factoryName: 'ignored parent', routeId: 8, deliveryLocation: 'ignored parent' });
    });
    expect(updateShipment).not.toHaveBeenCalled();
    expect(updateCusShipmentContainerLine).toHaveBeenCalledWith(5, 11, { expectedShipmentVersion: 2, operationalSiteId: 18 }, expect.any(String));
  });

  it('UI-CD-12 refuses an immutable FCL factory', async () => {
    const row = flatRow();
    const workspace = detail();
    workspace.summary.cargoMode = 'FCL';
    workspace.containers[0].fieldAccess.operationalSiteId = { mode: 'READ_ONLY', reason: 'Lô đã chốt' };
    const api = await setup(row, undefined, workspace);
    await expect(api.saveIdentity(row, { operationalSiteId: 18, factoryName: null, routeId: null, deliveryLocation: null })).rejects.toThrow('Lô đã chốt');
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
    expect(updateShipment).not.toHaveBeenCalled();
  });

  it('UI-CD-12 preserves the LCL parent identity command', async () => {
    const row = flatRow();
    const api = await setup(row);
    await act(async () => { await api.saveIdentity(row, { factoryName: 'Kho mới', routeId: 9, deliveryLocation: 'Điểm giao mới' }); });
    expect(updateShipment).toHaveBeenCalledWith(5, { expectedVersion: 2, factoryName: 'Kho mới', routeId: 9, deliveryLocation: 'Điểm giao mới' });
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
  });

  it('transport-only save on an appointment-less LCL row writes the shipment date and nothing else', async () => {
    const row = flatRow();
    const api = await setup(row);

    await act(async () => {
      await api.saveSchedule(line(), row, { transportDate: '2026-09-20', customerAppointmentAt: null });
    });

    expect(updateShipment).toHaveBeenCalledTimes(1);
    expect(updateShipment).toHaveBeenCalledWith(5, { expectedVersion: 2, expectedDeliveryDate: '2026-09-20' });
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
  });

  it('an untouched dated row with an appointment saves nothing', async () => {
    const row = flatRow({ transportDate: '2026-09-20', customerAppointmentAt: '2026-09-10T01:00:00.000Z' });
    const api = await setup(row, { customerAppointmentAt: '2026-09-10T01:00:00.000Z' });

    await act(async () => {
      await api.saveSchedule(line({ customerAppointmentAt: '2026-09-10T01:00:00.000Z' }), row, {
        transportDate: '2026-09-20',
        // 01:00Z reads 08:00 on the VN wall clock — the formatter's format.
        customerAppointmentAt: '2026-09-10T08:00',
      });
    });

    expect(updateShipment).not.toHaveBeenCalled();
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
  });

  it('still refuses a simultaneous transport + appointment change (two-step guard)', async () => {
    const row = flatRow();
    const api = await setup(row);

    await expect(act(async () => {
      await api.saveSchedule(line(), row, { transportDate: '2026-09-20', customerAppointmentAt: '2026-09-21T08:00' });
    })).rejects.toThrow('lưu độc lập');

    expect(updateShipment).not.toHaveBeenCalled();
    expect(updateCusShipmentContainerLine).not.toHaveBeenCalled();
  });
});
