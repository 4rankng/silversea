/**
 * SIL-638 (id 742) TC7 — Hàng Kết hợp (COMBINED) pairing rules.
 *
 * DOC logic-hang-kep-kethop (owner-standard):
 * (1) mismatched container sizes never pair — HARD block, verbatim text
 *     "Hàng kết hợp yêu cầu 2 lệnh phải có cùng kích cỡ container (cùng 20'
 *     hoặc cùng 40')" — note 40'+40' IS allowed (unlike kẹp);
 * (2) when the pair forms and Lệnh 2's số container is blank, it inherits
 *     Lệnh 1's shell number;
 * (3) VETC booked once for the pair (law pinned in the TC3 file; the
 *     pairing flow applies the same dedup to KET_HOP).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  backhaulTollDeductionForSecond,
  combinedContainerSizeBlockMessage,
  COMBINED_CONTAINER_SIZE_BLOCK_MESSAGE,
  containerNumberToInherit,
  declaredCombinedPairCarve,
  type DeclaredCombinedPairSide,
} from '../../services/trip-pair-rules.service';
import { buildTripPairSnapshot } from '../../services/trip-pairing.service';

describe('SIL-638 TC7(1) — kết hợp requires the same container size', () => {
  it('the block message is the DOC verbatim text', () => {
    assert.equal(COMBINED_CONTAINER_SIZE_BLOCK_MESSAGE, "Hàng kết hợp yêu cầu 2 lệnh phải có cùng kích cỡ container (cùng 20' hoặc cùng 40')");
  });

  it('same sizes pair — including 40′ + 40′ (the kẹp difference)', () => {
    assert.equal(combinedContainerSizeBlockMessage('20DV', '20RF'), null);
    assert.equal(combinedContainerSizeBlockMessage('40HC', '40HC'), null);
  });

  it('a proven mismatch blocks with the DOC text', () => {
    assert.equal(combinedContainerSizeBlockMessage('20DV', '40HC'), COMBINED_CONTAINER_SIZE_BLOCK_MESSAGE);
    assert.equal(combinedContainerSizeBlockMessage('40HC', '20GP'), COMBINED_CONTAINER_SIZE_BLOCK_MESSAGE);
  });

  it('an unknown size cannot prove a mismatch — same "bổ sung sau" convention as the number rule', () => {
    assert.equal(combinedContainerSizeBlockMessage(null, '40HC'), null);
    assert.equal(combinedContainerSizeBlockMessage('20DV', ''), null);
  });
});

describe('SIL-638 TC7(2) — Lệnh 2 inherits Lệnh 1’s số container when blank', () => {
  it('blank Lệnh 2 takes Lệnh 1’s shell number', () => {
    assert.equal(containerNumberToInherit('MSCU1234567', null), 'MSCU1234567');
    assert.equal(containerNumberToInherit('MSCU1234567', ''), 'MSCU1234567');
    assert.equal(containerNumberToInherit('MSCU1234567', '   '), 'MSCU1234567');
  });

  it('a number already present is never overwritten', () => {
    assert.equal(containerNumberToInherit('MSCU1234567', 'MSCU7654321'), null);
    assert.equal(containerNumberToInherit('MSCU1234567', 'MSCU1234567'), null);
  });

  it('no source number → nothing to inherit', () => {
    assert.equal(containerNumberToInherit(null, ''), null);
    assert.equal(containerNumberToInherit('', null), null);
  });

  it('the inherited value is trimmed', () => {
    assert.equal(containerNumberToInherit('  MSCU1234567  ', null), 'MSCU1234567');
  });
});

describe('SIL-638 TC7(3) — VETC once for a COMBINED pair', () => {
  it('the same single-booking dedup rides the KET_HOP pair', () => {
    const delta = backhaulTollDeductionForSecond({
      tollsStations: 2,
      tollPerStationApplied: '55000',
      tollDeduction: '0',
      tollCost: '110000',
      reconciledTollCost: null,
    });
    assert.equal(delta.tollDeduction, '110000');
    assert.equal(delta.tollCost, '0');
  });
});

// SIL-638 TC7 (QA 31/10) — "COMBINED legs bị overlap-reject → không tạo được
// pair COMBINED": the dispatcher plans both Kết hợp legs on the lot's shared
// appointment slot, issues both (the trip-side KET_HOP carve), then pairs
// them. The pairing gate's sequential-only rules (OVERLAP /
// IMPOSSIBLE_REPOSITION / INSUFFICIENT_TRAVEL_BUFFER + the first/second
// ordering assertion) must relax for a DECLARED pair — both fulfillments
// COMBINED, same truck, same driver, same business day — exactly like KEP's;
// the same-size gate (TC7(1)) is independent owner law and keeps blocking.
describe('SIL-638 TC7 — the declared Kết hợp pair carve', () => {
  const side = (overrides: Partial<DeclaredCombinedPairSide> = {}): DeclaredCombinedPairSide => ({
    classification: 'COMBINED',
    truckId: 1,
    driverId: 3,
    departureDate: '2026-10-31',
    ...overrides,
  });

  it('two declared COMBINED legs on one rig/day carve', () => {
    assert.equal(declaredCombinedPairCarve(side(), side()), true);
  });

  it('any non-declared side, different truck/driver/day, or missing day keeps the sequential rules', () => {
    assert.equal(declaredCombinedPairCarve(side({ classification: 'SINGLE' }), side()), false);
    assert.equal(declaredCombinedPairCarve(side(), side({ classification: 'DOUBLE' })), false);
    assert.equal(declaredCombinedPairCarve(side({ truckId: 2 }), side()), false);
    assert.equal(declaredCombinedPairCarve(side({ driverId: 4 }), side()), false);
    assert.equal(declaredCombinedPairCarve(side({ departureDate: '2026-11-01' }), side()), false);
    assert.equal(declaredCombinedPairCarve(side({ departureDate: null }), side()), false);
  });

  it('buildTripPairSnapshot: same-slot declared COMBINED legs pair — windows may coincide, no reposition chain', () => {
    // Both legs ride the same appointment slot (start ties break by trip id);
    // Lệnh 2's origin differs from Lệnh 1's destination (the shell-reuse run
    // was declared, not derived from locations).
    const legA = {
      tripId: 80,
      plannedStartAt: '2026-10-31T15:25:00.000Z',
      plannedEndAt: '2026-10-31T18:47:00.000Z',
      canonicalOrigin: 'Cang Dinh Vu',
      canonicalDestination: 'Kho Mipec',
      cargoWeightKg: 20000,
    };
    const legB = {
      tripId: 81,
      plannedStartAt: '2026-10-31T15:30:00.000Z',
      plannedEndAt: '2026-10-31T19:43:00.000Z',
      canonicalOrigin: 'Kho Mipec Khac',
      canonicalDestination: 'Nha may Nam Dinh',
      cargoWeightKg: 20000,
    };
    const carved = buildTripPairSnapshot(legA, legB, { vehicleCapacityKg: 50000 }, {
      kind: 'KET_HOP',
      declaredCombinedCarve: true,
    });
    assert.deepEqual(carved.blockingCodes, []);
    assert.equal(carved.eligible, true);
  });

  it('buildTripPairSnapshot: without the carve the same slot still blocks (default KET_HOP law unchanged)', () => {
    const legA = {
      tripId: 80,
      plannedStartAt: '2026-10-31T15:25:00.000Z',
      plannedEndAt: '2026-10-31T18:47:00.000Z',
      canonicalOrigin: 'Cang Dinh Vu',
      canonicalDestination: 'Kho Mipec',
      cargoWeightKg: 20000,
    };
    const legB = {
      tripId: 81,
      plannedStartAt: '2026-10-31T15:30:00.000Z',
      plannedEndAt: '2026-10-31T19:43:00.000Z',
      canonicalOrigin: 'Kho Mipec',
      canonicalDestination: 'Nha may Nam Dinh',
      cargoWeightKg: 20000,
    };
    const uncarved = buildTripPairSnapshot(legA, legB, { vehicleCapacityKg: 50000 }, { kind: 'KET_HOP' });
    assert.ok(uncarved.blockingCodes.includes('OVERLAP'));
    assert.equal(uncarved.eligible, false);
  });
});
