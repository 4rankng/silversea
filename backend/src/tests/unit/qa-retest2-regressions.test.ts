import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { atomicDispatchPlanEditSchema } from '@tingting/shared';
import { resolveExpectedRefundDate } from '../../services/deposit-refund-tracker.service';

describe('QA Retest 2 pure unit regressions (SIL-1124, SIL-1125, SIL-708)', () => {
  it('SIL-1125: recomputes expectedRefundDate to cvSubmittedDate + 14 when CV date changes without explicit override', () => {
    assert.equal(resolveExpectedRefundDate({
      prevCvDate: '2026-11-06',
      nextCvDate: '2026-10-27',
      prevExpectedDate: '2026-11-20',
      cvSubmittedDateProvided: true,
      inputExpectedRefundDate: undefined,
    }), '2026-11-10');

    assert.equal(resolveExpectedRefundDate({
      prevCvDate: null,
      nextCvDate: '2026-10-27',
      prevExpectedDate: '2026-11-20',
      cvSubmittedDateProvided: true,
      inputExpectedRefundDate: undefined,
    }), '2026-11-10');

    assert.equal(resolveExpectedRefundDate({
      prevCvDate: '2026-11-06',
      nextCvDate: '2026-10-27',
      prevExpectedDate: '2026-11-20',
      cvSubmittedDateProvided: true,
      inputExpectedRefundDate: '2026-11-15',
    }), '2026-11-15');

    assert.equal(resolveExpectedRefundDate({
      prevCvDate: '2026-10-27',
      nextCvDate: null,
      prevExpectedDate: '2026-11-10',
      cvSubmittedDateProvided: true,
      inputExpectedRefundDate: undefined,
    }), null);

    assert.equal(resolveExpectedRefundDate({
      prevCvDate: '2026-10-27',
      nextCvDate: '2026-10-27',
      prevExpectedDate: '2026-11-15',
      cvSubmittedDateProvided: false,
      inputExpectedRefundDate: undefined,
    }), '2026-11-15');
  });

  it('SIL-1124: debit-settlement-rounds overlap and lot errors use billOrBookNumberFor instead of internal shipmentCode', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/services/debit-settlement-rounds.service.ts'),
      'utf8',
    );
    const fnStart = src.indexOf('export async function createDebitSettlementRound');
    const fnEnd = src.indexOf('export async function', fnStart + 1);
    const body = src.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    assert.ok(!body.includes('s.shipments.shipmentCode'));
    assert.ok(body.includes('billOrBookNumberFor('));
    assert.ok(body.includes('Lô đã thuộc một đợt chốt:'));
  });

  it('SIL-708: atomicDispatchPlanEditSchema accepts carrierType: null for planned-row unassign and rejects contradictory carrier/vehicle fields', () => {
    const parsed = atomicDispatchPlanEditSchema.safeParse({
      expectedFulfillmentVersion: 1,
      expectedShipmentVersion: 1,
      carrierType: null,
      externalCarrierId: null,
      clearVehicle: true,
      plannedRevenue: null,
      plannedCarrierCost: null,
    });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.carrierType, null);
    }
    const contradictoryCarrier = atomicDispatchPlanEditSchema.safeParse({
      expectedFulfillmentVersion: 1,
      expectedShipmentVersion: 1,
      carrierType: null,
      externalCarrierId: 5,
      plannedRevenue: null,
      plannedCarrierCost: null,
    });
    assert.equal(contradictoryCarrier.success, false);
    const contradictoryVehicle = atomicDispatchPlanEditSchema.safeParse({
      expectedFulfillmentVersion: 1,
      expectedShipmentVersion: 1,
      carrierType: null,
      truckId: 12,
      plannedRevenue: null,
      plannedCarrierCost: null,
    });
    assert.equal(contradictoryVehicle.success, false);
  });
});
