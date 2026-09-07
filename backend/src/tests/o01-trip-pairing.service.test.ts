import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTripPairSnapshot,
  breakTripPairOnCancellation,
  breakTripPairOnLateCompletion,
  canonicalizePairingLocation,
  type TripPairSnapshot,
} from '../services/trip-pairing.service';

function trip(overrides: Partial<Parameters<typeof buildTripPairSnapshot>[0]> = {}) {
  return {
    tripId: 1,
    tripCode: 'TRIP-1',
    plannedStartAt: '2026-07-27T08:00:00.000Z',
    plannedEndAt: '2026-07-27T11:00:00.000Z',
    canonicalOrigin: 'Cảng Cát Lái',
    canonicalDestination: 'Kho Bình Dương',
    cargoWeightKg: 12000,
    loadedDistanceKm: 90,
    ...overrides,
  };
}

describe('trip pairing service', () => {
  test('canonicalizes Vietnamese locations deterministically', () => {
    assert.equal(
      canonicalizePairingLocation('  Cảng  Cát   Lái  '),
      'cang cat lai',
    );
    assert.equal(
      canonicalizePairingLocation('Kho Bình-Dương'),
      'kho binh duong',
    );
  });

  test('accepts a valid cross-day pair with no reposition', () => {
    const result = buildTripPairSnapshot(
      trip({
        tripId: 11,
        plannedStartAt: '2026-07-27T20:00:00.000Z',
        plannedEndAt: '2026-07-27T23:00:00.000Z',
        canonicalOrigin: 'Cảng Cát Lái',
        canonicalDestination: 'Kho Bình Dương',
        loadedDistanceKm: 95,
      }),
      trip({
        tripId: 22,
        plannedStartAt: '2026-07-28T06:00:00.000Z',
        plannedEndAt: '2026-07-28T10:00:00.000Z',
        canonicalOrigin: 'Kho Bình Dương',
        canonicalDestination: 'Cảng Cát Lái',
        cargoWeightKg: 11000,
        loadedDistanceKm: 92,
      }),
      { vehicleCapacityKg: 15000 },
    );

    assert.equal(result.eligible, true);
    assert.deepEqual(result.orderedTripIds, [11, 22]);
    assert.equal(result.emptyDistanceKm, 0);
    assert.equal(result.blockingCodes.length, 0);
    assert.equal(result.combinedEfficiencyPercent, 100);
  });

  test('rejects overlapping planned windows', () => {
    const result = buildTripPairSnapshot(
      trip({
        tripId: 11,
        plannedStartAt: '2026-07-27T08:00:00.000Z',
        plannedEndAt: '2026-07-27T12:00:00.000Z',
      }),
      trip({
        tripId: 22,
        plannedStartAt: '2026-07-27T11:30:00.000Z',
        plannedEndAt: '2026-07-27T14:00:00.000Z',
        canonicalOrigin: 'Kho Bình Dương',
        canonicalDestination: 'Cảng Cát Lái',
      }),
      { vehicleCapacityKg: 15000 },
    );

    assert.equal(result.eligible, false);
    assert.deepEqual(result.blockingCodes, ['OVERLAP', 'INSUFFICIENT_TRAVEL_BUFFER']);
  });

  // ─── Kind split (LoHangKepKetHop 2026-09-06: KEP = simultaneous) ──────────

  test('KEP accepts overlapping windows — both containers ride one mooc', () => {
    const result = buildTripPairSnapshot(
      trip({
        tripId: 11,
        plannedStartAt: '2026-07-27T08:00:00.000Z',
        plannedEndAt: '2026-07-27T12:00:00.000Z',
      }),
      trip({
        tripId: 22,
        plannedStartAt: '2026-07-27T08:00:00.000Z',
        plannedEndAt: '2026-07-27T12:00:00.000Z',
        canonicalOrigin: 'Cảng Cát Lái',
        canonicalDestination: 'Kho Bình Dương',
      }),
      { vehicleCapacityKg: 15000 },
      { kind: 'KEP' },
    );

    assert.equal(result.eligible, true);
    assert.equal(result.emptyDistanceKm, 0);
    assert.equal(result.requiredGapMinutes, null);
  });

  test('KEP skips the reposition chain — identical windows on different legs still pair', () => {
    const result = buildTripPairSnapshot(
      trip({
        tripId: 11,
        canonicalOrigin: 'Cảng Hải Phòng',
        canonicalDestination: 'Nhà máy Bắc Ninh',
      }),
      trip({
        tripId: 22,
        plannedStartAt: '2026-07-27T08:00:00.000Z',
        plannedEndAt: '2026-07-27T11:00:00.000Z',
        canonicalOrigin: 'Cảng Hải Phòng',
        canonicalDestination: 'Kho Thái Nguyên',
      }),
      { vehicleCapacityKg: 15000 },
      { kind: 'KEP' },
    );

    // KET_HOP rules would push IMPOSSIBLE_REPOSITION here (first destination
    // ≠ second origin); KEP carries both containers at once, so no chain.
    assert.equal(result.eligible, true);
    assert.ok(!result.blockingCodes.includes('IMPOSSIBLE_REPOSITION'));
  });

  test('KEP still enforces window validity, weights and capacity', () => {
    const result = buildTripPairSnapshot(
      trip({
        tripId: 11,
        plannedStartAt: '2026-07-27T12:00:00.000Z',
        plannedEndAt: '2026-07-27T08:00:00.000Z',
      }),
      trip({
        tripId: 22,
        canonicalOrigin: 'Cảng Cát Lái',
        canonicalDestination: 'Kho Bình Dương',
      }),
      { vehicleCapacityKg: 15000 },
      { kind: 'KEP' },
    );

    assert.equal(result.eligible, false);
    assert.ok(result.blockingCodes.includes('INVALID_PLANNED_WINDOW'));
  });

  test('KET_HOP (default) keeps the full sequential rule set', () => {
    const result = buildTripPairSnapshot(
      trip({
        tripId: 11,
        plannedEndAt: '2026-07-27T12:00:00.000Z',
      }),
      trip({
        tripId: 22,
        plannedStartAt: '2026-07-27T11:30:00.000Z',
        plannedEndAt: '2026-07-27T14:00:00.000Z',
        canonicalOrigin: 'Kho Bình Dương',
        canonicalDestination: 'Cảng Cát Lái',
      }),
      { vehicleCapacityKg: 15000 },
      { kind: 'KET_HOP' },
    );

    assert.equal(result.eligible, false);
    assert.deepEqual(result.blockingCodes, ['OVERLAP', 'INSUFFICIENT_TRAVEL_BUFFER']);
  });

  test('rejects impossible repositioning when destinations do not connect', () => {
    const result = buildTripPairSnapshot(
      trip({
        tripId: 11,
        canonicalDestination: 'Kho Sóng Thần',
      }),
      trip({
        tripId: 22,
        plannedStartAt: '2026-07-27T13:00:00.000Z',
        plannedEndAt: '2026-07-27T16:00:00.000Z',
        canonicalOrigin: 'ICD Long Bình',
        canonicalDestination: 'Cảng Cát Lái',
      }),
      { vehicleCapacityKg: 15000 },
    );

    assert.equal(result.eligible, false);
    assert.ok(result.blockingCodes.includes('IMPOSSIBLE_REPOSITION'));
    assert.equal(result.emptyDistanceKm, null);
  });

  test('rejects overload when either trip exceeds the truck capacity', () => {
    const result = buildTripPairSnapshot(
      trip({
        tripId: 11,
        cargoWeightKg: 18000,
      }),
      trip({
        tripId: 22,
        plannedStartAt: '2026-07-27T13:00:00.000Z',
        plannedEndAt: '2026-07-27T16:00:00.000Z',
        canonicalOrigin: 'Kho Bình Dương',
        canonicalDestination: 'Cảng Cát Lái',
      }),
      { vehicleCapacityKg: 15000 },
    );

    assert.equal(result.eligible, false);
    assert.ok(result.blockingCodes.includes('OVERLOAD'));
  });

  test('breaks the pair while preserving the surviving trip on cancellation', () => {
    const pair: TripPairSnapshot = {
      firstTripId: 11,
      secondTripId: 22,
      emptyDistanceKm: 0,
      combinedEfficiencyPercent: 100,
      actualGapMinutes: 120,
      requiredGapMinutes: 30,
    };

    assert.deepEqual(
      breakTripPairOnCancellation(pair, 11),
      {
        status: 'BROKEN',
        breakReason: 'FIRST_TRIP_CANCELED',
        survivingTripId: 22,
        lateByMinutes: null,
      },
    );
  });

  test('breaks the pair when late completion consumes the required buffer', () => {
    const pair: TripPairSnapshot = {
      firstTripId: 11,
      secondTripId: 22,
      emptyDistanceKm: 18,
      combinedEfficiencyPercent: 91.26,
      actualGapMinutes: 150,
      requiredGapMinutes: 90,
    };

    const result = breakTripPairOnLateCompletion(
      pair,
      '2026-07-27T12:15:00.000Z',
      '2026-07-27T13:30:00.000Z',
    );

    assert.deepEqual(result, {
      status: 'BROKEN',
      breakReason: 'LATE_COMPLETION',
      survivingTripId: 22,
      lateByMinutes: 15,
    });
  });
});
