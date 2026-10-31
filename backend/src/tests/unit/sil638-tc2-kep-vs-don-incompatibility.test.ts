/**
 * SIL-638 (id 742) TC2 — Cont A Kẹp + Cont B ĐƠN must NOT share a truck.
 *
 * DOC logic-hang-kep-kethop: "hệ thống từ chối lưu, báo lỗi không tương thích
 * (cần cả 2 cont cùng khai báo KẸP mới cho đi chung xe)".
 *
 * BE law (unit-pinned on the guard's pure decision layer): a ĐƠN issuing
 * context resolves NO carve mode, and a ĐƠN holder never satisfies the
 * declared-share or mixed-declaration predicates — so its overlap stays in
 * `blocking` and the guard hard-refuses (409 "Xe đầu kéo đã bị trùng lịch
 * kế hoạch."). The only ĐƠN-participant soft path is dis-03's mixed-
 * declaration kẹp candidate, which fires when the ISSUING leg is the Kẹp 20'
 * side (owner ruling card 211026131857 — the deliberate pre-pair share);
 * that path stays confirmable and is pinned here too.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  declaredKepShareMode,
  isDeclaredKepSharePartner,
  isMixedDeclarationKepCandidate,
  type KepSharePartnerRow,
} from '../../services/trip-pair-rules.service';

function partner(overrides: Partial<KepSharePartnerRow> = {}): KepSharePartnerRow {
  return {
    classification: 'SINGLE',
    truckId: 7,
    trailerId: 9,
    driverId: 5,
    plannedStartAt: new Date('2026-10-31T02:00:00.000Z'), // 09:00 ICT
    activePairId: null,
    pairFirstTripId: null,
    pairSecondTripId: null,
    ...overrides,
  };
}

interface TestShareRequest {
  tripId: number | null;
  truckId: number | null;
  trailerId: number | null;
  driverId: number | null;
  kep: { issuingContainerIsTwentyFoot: boolean; classification: string; departureDate: string | null } | null;
}

function request(
  overrides: {
    kep?: Partial<NonNullable<TestShareRequest['kep']>>;
  } & Partial<Omit<TestShareRequest, 'kep'>> = {},
): TestShareRequest {
  const { kep, ...rest } = overrides;
  return {
    tripId: 100,
    truckId: 7,
    trailerId: 9,
    driverId: 5,
    ...rest,
    kep: {
      issuingContainerIsTwentyFoot: true,
      classification: 'SINGLE',
      departureDate: '2026-10-31',
      ...kep,
    },
  };
}

describe('SIL-638 TC2 — a ĐƠN leg on a kẹp rig is refused (no carve path)', () => {
  const donRequest = request(); // issuing leg classified ĐƠN (SINGLE)
  // The guard derives the carve mode ONCE from the issuing context
  // (declaredKepShareMode) and only carves when that mode is non-null —
  // mirror that exact call pattern here.
  const donMode = declaredKepShareMode(donRequest.kep);

  it('a ĐƠN issuing context resolves no share mode at all', () => {
    assert.equal(donMode, null);
  });

  it('with no carve mode, no holder satisfies the declared-share carve', () => {
    const donHolder = partner({ classification: 'SINGLE' });
    const kepHolder = partner({ classification: 'DOUBLE' });
    assert.equal(isDeclaredKepSharePartner(donRequest, donHolder, donMode), false);
    assert.equal(isDeclaredKepSharePartner(donRequest, kepHolder, donMode), false);
  });

  it('the mixed-declaration candidate never fires for a ĐƠN ISSUING leg', () => {
    assert.equal(isMixedDeclarationKepCandidate(donRequest, partner()), false);
  });

  it('so a ĐƠN overlap stays in `blocking` → the guard keeps its hard 409 refusal', () => {
    // The guard carves only rows passing one of the two predicates; with a
    // kẹp holder and a ĐƠN issuer both refuse (TC2's shape) and so does the
    // reverse (ĐƠN holder, since the issuing ĐƠN has no mode).
    const kepHolder = partner({ classification: 'DOUBLE' });
    assert.equal(isDeclaredKepSharePartner(donRequest, kepHolder, donMode), false);
    assert.equal(isMixedDeclarationKepCandidate(donRequest, kepHolder), false);
    const kepRequest = request({ kep: { issuingContainerIsTwentyFoot: true, classification: 'DOUBLE', departureDate: '2026-10-31' } });
    assert.equal(isDeclaredKepSharePartner(kepRequest, partner({ classification: 'SINGLE' }), declaredKepShareMode(kepRequest.kep)), false);
  });
});

describe('SIL-638 TC2 — the deliberate kẹp share paths stay intact', () => {
  const kepRequest = request({ kep: { issuingContainerIsTwentyFoot: true, classification: 'DOUBLE', departureDate: '2026-10-31' } });
  const kepMode = declaredKepShareMode(kepRequest.kep);

  it('both legs declared Kẹp on the same rig + business day carve as the pair arrangement', () => {
    const unpairedKepPartner = partner({ classification: 'DOUBLE' });
    assert.equal(isDeclaredKepSharePartner(kepRequest, unpairedKepPartner, kepMode), true);
  });

  it('a different truck / driver / day breaks the share', () => {
    assert.equal(isDeclaredKepSharePartner(kepRequest, partner({ classification: 'DOUBLE', truckId: 8 }), kepMode), false);
    assert.equal(isDeclaredKepSharePartner(kepRequest, partner({ classification: 'DOUBLE', driverId: 6 }), kepMode), false);
    assert.equal(
      isDeclaredKepSharePartner(kepRequest, partner({ classification: 'DOUBLE', plannedStartAt: new Date('2026-11-01T02:00:00.000Z') }), kepMode),
      false,
    );
  });

  it('SIL-638 31/10: the mooc is not the pair contract (SIL-602) — equal or unassigned trailers carve, a declared mismatch blocks', () => {
    // Both sides unassigned (master-data imports leave the mooc blank): the
    // declaration + same truck/driver/day is the proof.
    assert.equal(isDeclaredKepSharePartner(
      { ...kepRequest, trailerId: null },
      partner({ classification: 'DOUBLE', trailerId: null }),
      kepMode,
    ), true);
    // One side unassigned: the truck is still the declared rig.
    assert.equal(isDeclaredKepSharePartner(kepRequest, partner({ classification: 'DOUBLE', trailerId: null }), kepMode), true);
    assert.equal(isDeclaredKepSharePartner(
      { ...kepRequest, trailerId: null },
      partner({ classification: 'DOUBLE', trailerId: 9 }),
      kepMode,
    ), true);
    // Two DECLARED but differing moocs are a foreign claim, never carved.
    assert.equal(isDeclaredKepSharePartner(
      kepRequest,
      partner({ classification: 'DOUBLE', trailerId: 12 }),
      kepMode,
    ), false);
  });

  it('a holder already paired to a third load stays blocking (never a third container)', () => {
    const pairedToThird = partner({
      classification: 'DOUBLE',
      activePairId: 55,
      pairFirstTripId: 41,
      pairSecondTripId: 42,
    });
    assert.equal(isDeclaredKepSharePartner(kepRequest, pairedToThird, kepMode), false);
    // …unless the pair is the issuing trip's own pair (reassign carve path).
    const ownPair = partner({
      classification: 'DOUBLE',
      activePairId: 55,
      pairFirstTripId: 100,
      pairSecondTripId: 42,
    });
    assert.equal(isDeclaredKepSharePartner(kepRequest, ownPair, kepMode), true);
  });

  it('dis-03: issuing Kẹp 20′ onto a sitting ĐƠN warns once (confirmable), scoped to one same-rig same-day holder', () => {
    assert.equal(isMixedDeclarationKepCandidate(kepRequest, partner({ classification: 'SINGLE' })), true);
    // A different truck is a foreign claim, not the arrangement.
    assert.equal(isMixedDeclarationKepCandidate(kepRequest, partner({ truckId: 8 })), false);
    // And the 40′ DOUBLE issuing side has no KEP mode, so no candidate either.
    const kep40Request = request({ kep: { issuingContainerIsTwentyFoot: false, classification: 'DOUBLE', departureDate: '2026-10-31' } });
    assert.equal(isMixedDeclarationKepCandidate(kep40Request, partner({ classification: 'SINGLE' })), false);
  });
});
