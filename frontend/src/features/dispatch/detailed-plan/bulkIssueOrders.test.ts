/**
 * SIL-893 — the batch-release runner laws (`bulkIssueRows` on /dispatch-detail):
 *   • PARTIAL SUCCESS — one bad row never cancels the batch; every failure
 *     lands in the outcome with its identity + reason.
 *   • KHÔNG TẠO TRÙNG CHUYẾN — a row already carrying a lệnh (stale pick or
 *     re-click) refuses before any write; the server backs this with its own
 *     live-trip 409, the runner's gate keeps the batch honest client-side.
 *   • The release body mirrors the single-row quick-issue: OWN rows carry the
 *     resolved truck+driver, external rows the carrier ids; planned times
 *     ride the row's CUS-locked schedule (draftIssueTimesFor).
 *   • Soft-warn 409s (plate-deferred, rig overlap, Kẹp weight) pause the batch
 *     for the caller's confirm dialog (SIL-898): a confirmed choice re-releases
 *     only those rows with the per-row flags; declining (or no callback) fails
 *     them with the per-row hint — a batch never answers a confirm silently.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listFleetMock = vi.fn();
vi.mock('../../../api/dispatchPlanningClient', () => ({
  listDispatchFleetResources: (...args: unknown[]) => listFleetMock(...args),
}));

import { bulkIssueRows, bulkIssueEligibility, bulkIssueTargets } from './bulkIssueOrders';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentResponse } from '../../../api/shipmentClient';

const ok = {} as DispatchShipmentResponse;

const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-08-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: 'Nhà máy XYZ', deliveryPoint: 'Kho Bình Dương', routeName: 'LH — Biên Hòa' },
  docs: { billNumber: 'BL-2026-010', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSCU1234567', containerTypeLabel: '40HC', cargoWeightKg: '21500.00' },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51C-12345' },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  isCombined: false,
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  lotFullyPlated: false,
  ...overrides,
} as DispatchDetailPlanRow);

const truck = (overrides: Partial<{ id: number; licensePlate: string; assignedDriverId: number | null }> = {}) =>
  ({ id: 12, licensePlate: '51C-12345', assignedDriverId: 34, ...overrides });

beforeEach(() => {
  listFleetMock.mockReset();
});

describe('bulkIssueRows — partial success', () => {
  it('issues every eligible row in order and reports no failures', async () => {
    listFleetMock.mockResolvedValue({ items: [truck()] });
    const externalDeferred = row({
      fulfillmentId: 102,
      container: { containerNumber: 'TEMU7654321', containerTypeLabel: '20DC', cargoWeightKg: '18000.00' },
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Thanh Phong', externalCarrierId: 8, externalCarrierVehicleId: null, assignedPlate: null },
    });
    const onIssueOrder = vi.fn().mockResolvedValue(ok);
    const outcome = await bulkIssueRows([row(), externalDeferred], onIssueOrder);

    expect(outcome.issued).toBe(2);
    expect(outcome.failures).toEqual([]);
    // CR-010.1 BUG-03 — the summary table lists every released row, so
    // successes keep their cont/Bill identity too (same order as the batch).
    expect(outcome.successes).toEqual([
      { fulfillmentId: 101, identity: 'MSCU1234567 · BL-2026-010' },
      { fulfillmentId: 102, identity: 'TEMU7654321 · BL-2026-010' },
    ]);
    // Sequential release, click order — a just-issued sibling can never slip
    // a second trip past the grid's snapshot.
    expect(onIssueOrder.mock.calls[0][0].fulfillmentId).toBe(101);
    expect(onIssueOrder.mock.calls[1][0].fulfillmentId).toBe(102);
  });

  it('one failing row never cancels the batch — failures carry identity + message', async () => {
    listFleetMock.mockResolvedValue({ items: [truck()] });
    const blocked = row({
      fulfillmentId: 103,
      container: { containerNumber: 'MSCU9999999', containerTypeLabel: '40HC', cargoWeightKg: '21500.00' },
    });
    const onIssueOrder = vi.fn()
      .mockResolvedValueOnce(ok)
      .mockRejectedValueOnce(new Error('Rơ-moóc không phù hợp với loại container.'))
      .mockResolvedValueOnce(ok);
    const outcome = await bulkIssueRows([row(), blocked, row({ fulfillmentId: 104, container: { containerNumber: 'TEMU8888888', containerTypeLabel: '20DC', cargoWeightKg: '19000.00' } })], onIssueOrder);

    expect(outcome.issued).toBe(2);
    expect(outcome.failures).toEqual([
      { fulfillmentId: 103, identity: 'MSCU9999999 · BL-2026-010', message: 'Rơ-moóc không phù hợp với loại container.' },
    ]);
    // The summary table's two sections: the failed row sits between the two
    // released ones, each success carrying its own identity.
    expect(outcome.successes).toEqual([
      { fulfillmentId: 101, identity: 'MSCU1234567 · BL-2026-010' },
      { fulfillmentId: 104, identity: 'TEMU8888888 · BL-2026-010' },
    ]);
    expect(onIssueOrder).toHaveBeenCalledTimes(3);
  });

  // CR-010.1 (SIL-898 b) — two lots sharing ONE container number (QA 24/11:
  // both summary rows read 'RTAU4012043') must stay distinguishable: the
  // Bill rides the identity, so the two rows differ.
  it('a shared container number still yields distinct identities — the Bill rides along', async () => {
    listFleetMock.mockResolvedValue({ items: [truck()] });
    const onIssueOrder = vi.fn().mockResolvedValue(ok);
    const sharedCont = { containerNumber: 'RTAU4012043', containerTypeLabel: '20DC', cargoWeightKg: '18000.00' };
    const outcome = await bulkIssueRows([
      row({ fulfillmentId: 201, docs: { billNumber: 'R3Q-680-A', tradeDirection: 'EXPORT', declarationNumbers: [] }, container: sharedCont }),
      row({ fulfillmentId: 202, docs: { billNumber: 'R3Q-680-B', tradeDirection: 'EXPORT', declarationNumbers: [] }, container: sharedCont }),
    ], onIssueOrder);

    expect(outcome.failures).toEqual([]);
    expect(outcome.successes).toEqual([
      { fulfillmentId: 201, identity: 'RTAU4012043 · R3Q-680-A' },
      { fulfillmentId: 202, identity: 'RTAU4012043 · R3Q-680-B' },
    ]);
  });
});

describe('bulkIssueRows — không tạo trùng chuyến', () => {
  it('a row already issued refuses without any write (repeated click law)', async () => {
    const issued = row({
      taskStatus: 'DISPATCHED',
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51C-12345', tripId: 77 },
    });
    const onIssueOrder = vi.fn().mockResolvedValue(ok);
    const outcome = await bulkIssueRows([issued], onIssueOrder);

    expect(outcome.issued).toBe(0);
    expect(outcome.failures).toEqual([
      { fulfillmentId: 101, identity: 'MSCU1234567 · BL-2026-010', message: 'Đã phát lệnh rồi.' },
    ]);
    expect(onIssueOrder).not.toHaveBeenCalled();
  });

  it('a stale pick carrying a trip id refuses even while its status still reads READY', async () => {
    // The grid snapshot flipped under the operator: status not yet refetched,
    // but the sibling release already created the trip for this fulfillment.
    const stale = row({
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51C-12345', tripId: 90 },
    });
    const onIssueOrder = vi.fn().mockResolvedValue(ok);
    const outcome = await bulkIssueRows([stale], onIssueOrder);

    expect(outcome.issued).toBe(0);
    expect(outcome.failures[0].message).toBe('Đã phát lệnh rồi.');
    expect(onIssueOrder).not.toHaveBeenCalled();
    expect(listFleetMock).not.toHaveBeenCalled();
  });
});

describe('bulkIssueRows — release body mirrors the single-row quick-issue', () => {
  it('OWN rows carry the resolved truck + driver and the CUS-locked times', async () => {
    listFleetMock.mockResolvedValue({ items: [truck({ id: 12, licensePlate: '51C-12345', assignedDriverId: 34 })] });
    const onIssueOrder = vi.fn().mockResolvedValue(ok);
    await bulkIssueRows([row()], onIssueOrder);

    const body = onIssueOrder.mock.calls[0][1];
    expect(body).toMatchObject({
      carrierType: 'OWN',
      truckId: 12,
      driverId: 34,
      endTimeConfirmed: true,
    });
    expect(body.externalCarrierId).toBeUndefined();
    expect(body.externalCarrierVehicleId).toBeUndefined();
    expect(body.externalPlateNumber).toBeUndefined();
    expect(new Date(body.plannedStartAt).getTime()).not.toBeNaN();
    expect(new Date(body.plannedEndAt).getTime()).toBeGreaterThan(new Date(body.plannedStartAt).getTime());
  });

  it('external rows carry the carrier ids and never a truck/driver', async () => {
    const externalBound = row({
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Thanh Phong', externalCarrierId: 8, externalCarrierVehicleId: 5, assignedPlate: '15H-012.34' },
    });
    const onIssueOrder = vi.fn().mockResolvedValue(ok);
    await bulkIssueRows([externalBound], onIssueOrder);

    const body = onIssueOrder.mock.calls[0][1];
    expect(body).toMatchObject({ carrierType: 'EXTERNAL', externalCarrierId: 8, externalCarrierVehicleId: 5 });
    expect(body.truckId).toBeUndefined();
    expect(body.driverId).toBeUndefined();
    // A bound carrier vehicle owns the plate — the body ships none.
    expect(body.externalPlateNumber).toBeUndefined();
    expect(listFleetMock).not.toHaveBeenCalled();
  });
});

describe('bulkIssueRows — per-row guards', () => {
  it('an OWN truck without a driver fails with the fix hint, batch continues', async () => {
    listFleetMock
      .mockResolvedValueOnce({ items: [truck({ assignedDriverId: null })] })
      .mockResolvedValueOnce({ items: [truck({ licensePlate: '51C-99999', assignedDriverId: 34 })] });
    const driverless = row({ fulfillmentId: 105 });
    const fine = row({
      fulfillmentId: 106,
      dispatch: { ...row().dispatch, assignedPlate: '51C-99999' },
      container: { containerNumber: 'TEMU1111111', containerTypeLabel: '20DC', cargoWeightKg: '19000.00' },
    });
    const onIssueOrder = vi.fn().mockResolvedValue(ok);
    const outcome = await bulkIssueRows([driverless, fine], onIssueOrder);

    expect(outcome.issued).toBe(1);
    expect(outcome.failures[0].fulfillmentId).toBe(105);
    expect(outcome.failures[0].message).toContain('Xe chưa gán tài xế');
  });

  it('a soft-warn 409 (plate-deferred) fails with the per-row hint, never a confirm', async () => {
    const plateless = row({
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Thanh Phong', externalCarrierId: 8, externalCarrierVehicleId: null, assignedPlate: null },
    });
    const deferred409 = Object.assign(
      new Error('Phát lệnh chưa có biển số xe nhà xe ngoài — chuyến sẽ ghi nhận "chưa có biển" cho đến khi bổ sung qua Cập nhật biển số.'),
      { status: 409, raw: { code: 'PLATE_DEFERRED_CONFIRM' } },
    );
    const onIssueOrder = vi.fn().mockRejectedValue(deferred409);
    const outcome = await bulkIssueRows([plateless], onIssueOrder);

    expect(outcome.issued).toBe(0);
    expect(outcome.failures[0].message).toContain('dùng nút Phát lệnh trên dòng');
  });

  it('two OWN rows on the same plate share one fleet-catalog lookup', async () => {
    listFleetMock.mockResolvedValue({ items: [truck()] });
    const onIssueOrder = vi.fn().mockResolvedValue(ok);
    const outcome = await bulkIssueRows([
      row(),
      row({ fulfillmentId: 107, container: { containerNumber: 'TEMU2222222', containerTypeLabel: '20DC', cargoWeightKg: '18000.00' } }),
    ], onIssueOrder);

    expect(outcome.issued).toBe(2);
    expect(listFleetMock).toHaveBeenCalledTimes(1);
  });
});

describe('bulkIssueEligibility — the checkbox gate', () => {
  it('gates every blocked state with its reason and admits the issuable two', () => {
    expect(bulkIssueEligibility(row({ dispatch: { carrierType: 'OWN', carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null } })))
      .toEqual({ eligible: false, reason: 'Lô chưa được điều xe — gán xe trước khi phát lệnh.' });
    expect(bulkIssueEligibility(row({
      taskStatus: 'DISPATCHED',
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51C-12345', tripId: 77 },
    })))
      .toEqual({ eligible: false, reason: 'Đã phát lệnh rồi.' });
    expect(bulkIssueEligibility(row({ taskStatus: 'COMPLETED' })))
      .toEqual({ eligible: false, reason: 'Đã hoàn thành — lịch sử đóng băng.' });
    expect(bulkIssueEligibility(row()).eligible).toBe(true);
    expect(bulkIssueEligibility(row({
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Thanh Phong', externalCarrierId: 8, externalCarrierVehicleId: null, assignedPlate: null },
    })).eligible).toBe(true);
  });
});

describe('bulkIssueTargets — the pick outlives the search window (SIL-898, BUG-03 retest)', () => {
  const pickedEarlierSearch = row({
    fulfillmentId: 201,
    container: { containerNumber: 'TEMU1111111', containerTypeLabel: '20DC', cargoWeightKg: '19000.00' },
  });
  const pickedStillVisible = row({
    fulfillmentId: 202,
    container: { containerNumber: 'TEMU2222222', containerTypeLabel: '20DC', cargoWeightKg: '18000.00' },
  });
  const fresherGridRow = row({
    fulfillmentId: 202,
    version: 9,
    container: { containerNumber: 'TEMU2222222', containerTypeLabel: '20DC', cargoWeightKg: '18001.00' },
  });

  it('releases every pick: a row the current search no longer lists rides its snapshot, a visible row rides the fresher grid row', () => {
    const targets = bulkIssueTargets(
      new Map([[201, pickedEarlierSearch], [202, pickedStillVisible]]),
      [fresherGridRow, row({ fulfillmentId: 303 })],
    );

    expect(targets).toEqual([pickedEarlierSearch, fresherGridRow]);
  });

  it('an empty pick releases nothing even when the grid lists rows', () => {
    expect(bulkIssueTargets(new Map(), [row()])).toEqual([]);
  });

  it('the cross-search repro fires one POST per pick — two ticks across two searches, two releases', async () => {
    listFleetMock.mockResolvedValue({ items: [truck()] });
    const onIssueOrder = vi.fn().mockResolvedValue(ok);
    const picks = [pickedEarlierSearch, pickedStillVisible];
    const targets = bulkIssueTargets(new Map(picks.map((r) => [r.fulfillmentId, r])), [pickedStillVisible]);

    const outcome = await bulkIssueRows(targets, onIssueOrder);

    expect(onIssueOrder).toHaveBeenCalledTimes(2);
    expect(onIssueOrder.mock.calls.map(([released]) => released.fulfillmentId)).toEqual([201, 202]);
    expect(outcome.issued).toBe(2);
    expect(outcome.failures).toEqual([]);
  });
});

describe('bulkIssueRows — the batch warn confirm (SIL-898, QA 24/11 12:37)', () => {
  // The QA repro warn shapes, pinned to their exact server contracts:
  // R3M-KQ1 — a finished trip's staged rig slot: the HARD refusal
  //           (409 RIG_OVERLAP_FINISHED_TRIP) — terminal, never confirmable.
  // R15-DRV-KEP — Kẹp weight warn-once (409 KEP_WEIGHT_WARNING): confirmable.
  // The cross-lot named-lot overlap (409 RIG_OVERLAP_COMPLETED) stays the
  // confirmable soft tier the different-lot flow rides today.
  const finishedSlot409 = Object.assign(
    new Error('Đầu xe 15H-104.03 có 1 chuyến đã hoàn thành trùng khung giờ phân công này — trùng lịch thực với khung giờ chuyến đã hoàn thành, không thể ghi đè. Vui lòng chọn khung giờ phân công khác.'),
    { status: 409, raw: { code: 'RIG_OVERLAP_FINISHED_TRIP' } },
  );
  const softOverlap409 = Object.assign(
    new Error('Đầu xe 15E-016.26 đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp. Vẫn lưu?'),
    { status: 409, raw: { code: 'RIG_OVERLAP_COMPLETED' } },
  );
  const kepWeight409 = Object.assign(
    new Error('Tổng tải trọng hàng ước tính có thể vượt tải trọng cho phép của phương tiện, Điều vận vui lòng kiểm tra lại'),
    { status: 409 },
  );
  const r3mRow = () => row({
    fulfillmentId: 301,
    docs: { billNumber: 'R3M-KQ1', tradeDirection: 'IMPORT', declarationNumbers: [] },
    container: { containerNumber: 'RTAU4000119', containerTypeLabel: '20DC', cargoWeightKg: '5000.00' },
  });
  const r15Row = () => row({
    fulfillmentId: 302,
    docs: { billNumber: 'R15-DRV-KEP', tradeDirection: 'IMPORT', declarationNumbers: [] },
    container: { containerNumber: 'RTAU4012151', containerTypeLabel: '20DC', cargoWeightKg: '5000.00' },
  });

  it('a finished trip staged slot refusal is terminal — the batch confirm round never opens for it', async () => {
    // Rig-slot law: the hard RIG_OVERLAP_FINISHED_TRIP tier sits outside the
    // soft-confirm family, so the row lands straight in the summary with the
    // explainable copy — no confirmWarnings round, no flagged retry.
    listFleetMock.mockResolvedValue({ items: [truck()] });
    const onIssueOrder = vi.fn().mockRejectedValue(finishedSlot409);
    const confirmWarnings = vi.fn().mockResolvedValue(true);

    const outcome = await bulkIssueRows([r3mRow()], onIssueOrder, { confirmWarnings });

    expect(confirmWarnings).not.toHaveBeenCalled();
    expect(onIssueOrder).toHaveBeenCalledTimes(1);
    expect(outcome.issued).toBe(0);
    expect(outcome.failures).toEqual([
      expect.objectContaining({
        fulfillmentId: 301,
        identity: 'RTAU4000119 · R3M-KQ1',
        message: expect.stringContaining('không thể ghi đè'),
      }),
    ]);
    expect(outcome.failures[0]!.message).not.toContain('Vẫn lưu');
  });

  it('a soft warn row pauses the batch; confirming re-releases it with the row confirm flag and it issues', async () => {
    listFleetMock.mockResolvedValue({ items: [truck()] });
    const onIssueOrder = vi.fn()
      .mockRejectedValueOnce(softOverlap409)
      .mockResolvedValueOnce(ok);
    const confirmWarnings = vi.fn().mockResolvedValue(true);

    const outcome = await bulkIssueRows([r3mRow()], onIssueOrder, { confirmWarnings });

    expect(confirmWarnings).toHaveBeenCalledTimes(1);
    expect(confirmWarnings.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        fulfillmentId: 301,
        identity: 'RTAU4000119 · R3M-KQ1',
        code: 'RIG_OVERLAP_COMPLETED',
        message: expect.stringContaining('Vẫn lưu?'),
      }),
    ]);
    expect(onIssueOrder).toHaveBeenCalledTimes(2);
    expect(onIssueOrder.mock.calls[1][1]).toMatchObject({ rigOverlapCompletedConfirmed: true });
    expect(onIssueOrder.mock.calls[1][2]).toEqual({ fromBulk: true });
    expect(outcome.issued).toBe(1);
    expect(outcome.failures).toEqual([]);
    expect(outcome.successes.map((success) => success.identity)).toEqual(['RTAU4000119 · R3M-KQ1']);
  });

  it('a KEP weight warn (message-fallback shape) retries with kepWeightWarningConfirmed', async () => {
    listFleetMock.mockResolvedValue({ items: [truck()] });
    const onIssueOrder = vi.fn()
      .mockRejectedValueOnce(kepWeight409)
      .mockResolvedValueOnce(ok);
    const confirmWarnings = vi.fn().mockResolvedValue(true);

    const outcome = await bulkIssueRows([r15Row()], onIssueOrder, { confirmWarnings });

    expect(confirmWarnings.mock.calls[0][0][0]).toMatchObject({ code: 'KEP_WEIGHT_WARNING', fulfillmentId: 302 });
    expect(onIssueOrder.mock.calls[1][1]).toMatchObject({ kepWeightWarningConfirmed: true });
    expect(outcome.issued).toBe(1);
    expect(outcome.failures).toEqual([]);
  });

  it('a clean row issues in pass one and the confirm round re-releases only the warn rows', async () => {
    listFleetMock.mockResolvedValue({ items: [truck()] });
    const onIssueOrder = vi.fn()
      .mockResolvedValueOnce(ok) // clean row, pass one
      .mockRejectedValueOnce(softOverlap409) // warn row, pass one
      .mockResolvedValueOnce(ok); // warn row, confirmed retry
    const confirmWarnings = vi.fn().mockResolvedValue(true);

    const outcome = await bulkIssueRows([row({ fulfillmentId: 300 }), r3mRow()], onIssueOrder, { confirmWarnings });

    expect(onIssueOrder).toHaveBeenCalledTimes(3);
    expect(onIssueOrder.mock.calls.map(([released, body]) => [released.fulfillmentId, body.rigOverlapCompletedConfirmed ?? false]))
      .toEqual([[300, false], [301, false], [301, true]]);
    expect(outcome.issued).toBe(2);
    expect(outcome.failures).toEqual([]);
  });

  it('declining keeps the warn rows unissued — server copy plus the decline reason, no retry', async () => {
    listFleetMock.mockResolvedValue({ items: [truck()] });
    const onIssueOrder = vi.fn().mockRejectedValue(softOverlap409);
    const confirmWarnings = vi.fn().mockResolvedValue(false);

    const outcome = await bulkIssueRows([r3mRow()], onIssueOrder, { confirmWarnings });

    expect(onIssueOrder).toHaveBeenCalledTimes(1);
    expect(outcome.issued).toBe(0);
    expect(outcome.failures[0].message).toContain('Vẫn lưu?');
    expect(outcome.failures[0].message).toContain('đã hủy xác nhận');
  });

  it('a warn row that still fails after confirm lands as a terminal failure — no loop', async () => {
    listFleetMock.mockResolvedValue({ items: [truck()] });
    const onIssueOrder = vi.fn()
      .mockRejectedValueOnce(softOverlap409)
      .mockRejectedValueOnce(Object.assign(new Error('Xe đầu kéo đã bị trùng lịch kế hoạch.'), { status: 409 }));
    const confirmWarnings = vi.fn().mockResolvedValue(true);

    const outcome = await bulkIssueRows([r3mRow()], onIssueOrder, { confirmWarnings });

    expect(onIssueOrder).toHaveBeenCalledTimes(2);
    expect(outcome.issued).toBe(0);
    expect(outcome.failures[0].message).toBe('Xe đầu kéo đã bị trùng lịch kế hoạch.');
  });

  it('without a confirmWarnings callback the warn row keeps the legacy summary-hint failure', async () => {
    listFleetMock.mockResolvedValue({ items: [truck()] });
    const onIssueOrder = vi.fn().mockRejectedValue(softOverlap409);

    const outcome = await bulkIssueRows([r3mRow()], onIssueOrder);

    expect(onIssueOrder).toHaveBeenCalledTimes(1);
    expect(outcome.issued).toBe(0);
    expect(outcome.failures[0].message).toContain('Vẫn lưu?');
    expect(outcome.failures[0].message).toContain('dùng nút Phát lệnh trên dòng');
  });
});
