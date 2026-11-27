import { describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentResponse } from '../../../api/shipmentClient';
import { bulkIssueRows } from './bulkIssueOrders';
import { detectIssueSoftConfirm, detectSaveSoftConfirm } from './dispatchSoftConfirm';

function makeExternalReadyRow(fulfillmentId = 101): DispatchDetailPlanRow {
  return {
    fulfillmentId,
    shipmentId: 201,
    shipmentCode: 'SHP-2611-00101',
    version: 3,
    shipmentVersion: 2,
    shipmentContainerId: 301,
    cargoMode: 'FCL',
    taskStatus: 'READY',
    classification: 'PAIR',
    isCombined: false,
    docs: {
      billNumber: 'BL-CHAIN-01',
      bookingRef: null,
      customerName: 'Khách test',
      declarationNumber: null,
    },
    container: {
      containerNumber: 'CONT2000001',
      containerType: '20GP',
      cargoWeightKg: '15000',
    },
    time: {
      runAt: '2026-11-28T08:00:00.000Z',
      deliveryDate: '2026-11-28',
      runHour: '08:00',
      plannedEndAt: '2026-11-28T16:00:00.000Z',
    },
    route: {
      pickupPoint: 'Cảng HP',
      deliveryPoint: 'KCN VSIP',
      dropoffPoint: 'Cảng HP',
      zone: 'HP',
    },
    dispatch: {
      carrierType: 'EXTERNAL',
      externalCarrierId: 55,
      externalCarrierName: 'Nhà xe A',
      externalCarrierVehicleId: 77,
      assignedPlate: '15H-052.82',
      assignedDriverName: 'Tài xế A',
      assignedTrailerPlate: null,
      tripId: null,
      tripStatus: null,
      hasActiveHandoff: false,
    },
    estimates: {
      plannedRevenue: null,
      plannedCarrierCost: null,
    },
    lcl: null,
    operationalNotes: null,
    tags: [],
  } as unknown as DispatchDetailPlanRow;
}

describe('dispatchSoftConfirm', () => {
  it('maps every issue soft-409 code to its confirm flag and ignores non-409 errors', () => {
    expect(detectIssueSoftConfirm({ status: 409, raw: { code: 'KEP_WEIGHT_WARNING' }, message: 'Quá tải' })?.flag)
      .toBe('kepWeightWarningConfirmed');
    expect(detectIssueSoftConfirm({ status: 409, raw: { code: 'RIG_OVERLAP_COMPLETED' }, message: 'Trùng lịch' })?.flag)
      .toBe('rigOverlapCompletedConfirmed');
    expect(detectIssueSoftConfirm({ status: 409, raw: { code: 'PLATE_DEFERRED_CONFIRM' }, message: 'Chưa biển số' })?.flag)
      .toBe('plateDeferredConfirmed');
    expect(detectIssueSoftConfirm({ status: 400, raw: { code: 'RIG_OVERLAP_COMPLETED' }, message: 'Bad' }))
      .toBeNull();
  });

  it('the finished-trip slot refusal is a hard error — no surface offers the confirm retry', () => {
    // Rig-slot law: a completed trip's staged rig slot is a real double-
    // booking. The server refuses it with RIG_OVERLAP_FINISHED_TRIP, which is
    // deliberately outside both soft lists so every surface renders the plain
    // explainable error — never a 'Vẫn lưu?' button whose retry cannot clear.
    const hard = { status: 409, raw: { code: 'RIG_OVERLAP_FINISHED_TRIP' }, message: '…không thể ghi đè. Vui lòng chọn khung giờ phân công khác.' };
    expect(detectIssueSoftConfirm(hard)).toBeNull();
    expect(detectSaveSoftConfirm(hard)).toBeNull();
  });

  it('maps every save soft-409 code to its confirm flag and appends Vẫn lưu? when needed', () => {
    const weight = detectSaveSoftConfirm({
      status: 409,
      raw: { code: 'KEP_WEIGHT_WARNING' },
      message: 'Tổng tải trọng vượt tải trọng cho phép',
    });
    expect(weight?.flag).toBe('kepWeightWarningConfirmed');
    expect(weight?.confirmPrompt).toContain('Vẫn lưu?');

    const split = detectSaveSoftConfirm({
      status: 409,
      raw: { code: 'KEP_PAIR_SPLIT_WARNING' },
      message: '2 chân Kẹp phải cùng xe',
    });
    expect(split?.flag).toBe('kepPairSplitConfirmed');
    expect(split?.confirmPrompt).toContain('Vẫn lưu?');
  });
});

describe('bulkIssueRows — chained soft-409 overrides', () => {
  it('accumulates flags across sequential KEP_WEIGHT_WARNING then RIG_OVERLAP_COMPLETED and succeeds', async () => {
    const row = makeExternalReadyRow(501);
    const seenBodies: Array<Record<string, unknown>> = [];
    const onIssueOrder = vi.fn(async (_row, body) => {
      seenBodies.push(body as Record<string, unknown>);
      if (seenBodies.length === 1) {
        throw Object.assign(new Error('Tổng tải trọng vượt tải trọng cho phép'), {
          status: 409,
          raw: { code: 'KEP_WEIGHT_WARNING' },
        });
      }
      if (seenBodies.length === 2) {
        throw Object.assign(new Error('Đầu xe 15H-052.82 trùng lịch Kẹp. Vẫn lưu?'), {
          status: 409,
          raw: { code: 'RIG_OVERLAP_COMPLETED' },
        });
      }
      return { trip: { id: 9001, status: 'CREATED' }, version: 4 } as unknown as DispatchShipmentResponse;
    });

    const confirmWarnings = vi.fn(async () => true);
    const outcome = await bulkIssueRows([row], onIssueOrder, { confirmWarnings });

    expect(outcome.issued).toBe(1);
    expect(outcome.failures).toHaveLength(0);
    expect(confirmWarnings).toHaveBeenCalledTimes(2);
    expect(seenBodies[1]).toMatchObject({ kepWeightWarningConfirmed: true });
    expect(seenBodies[2]).toMatchObject({
      kepWeightWarningConfirmed: true,
      rigOverlapCompletedConfirmed: true,
    });
  });

  it('terminates without looping if the same soft-409 code repeats after its flag was already sent', async () => {
    const row = makeExternalReadyRow(502);
    const onIssueOrder = vi.fn(async () => {
      throw Object.assign(new Error('Đầu xe 15H-052.82 trùng lịch. Vẫn lưu?'), {
        status: 409,
        raw: { code: 'RIG_OVERLAP_COMPLETED' },
      });
    });

    const confirmWarnings = vi.fn(async () => true);
    const outcome = await bulkIssueRows([row], onIssueOrder, { confirmWarnings });

    expect(outcome.issued).toBe(0);
    expect(outcome.failures).toHaveLength(1);
    expect(confirmWarnings).toHaveBeenCalledTimes(1);
    expect(onIssueOrder).toHaveBeenCalledTimes(2);
  });
});
