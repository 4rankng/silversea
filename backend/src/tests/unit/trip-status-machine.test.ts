/**
 * Trip Status Machine — Transition validation rules
 *
 * These tests validate the status transition matrix and role permission rules
 * as documented in docs/flows/01-TRIP_LIFECYCLE.md, encoded in the
 * transitionTripStatus function in trip-status-machine.service.ts.
 *
 * O2C reconciliation (01/08/2026): the LOCKED milestone was dropped — COMPLETED
 * is the single terminal/posting state. The IN_TRANSIT → COMPLETED transition
 * now carries the migrated photo / zero-revenue / e-POD gates and requires
 * podRecoveredAt (POD gate). A completed trip reopens COMPLETED → IN_TRANSIT
 * only via the governed TRIP_REOPEN action.
 *
 * The actual service function is tightly coupled to the database transaction,
 * so we test the business rules as pure data-driven tests that document the
 * expected behavior. If the service is ever refactored to extract a pure
 * validation layer, these tests should be pointed at it directly.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isTripRunningOnDepartureDay, isActiveKepPairPartner } from '../../services/trip-busy-gate';

// ── Transition Matrix ──────────────────────────────────────────────────────
// Which target statuses are valid from each current status?
// Derived from transitionTripStatus() guard conditions.

type Status = 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELED';

interface TransitionRule {
  from: Status;
  to: Status;
  allowed: boolean;
  roles: string[];       // Minimum roles allowed (empty = not applicable)
  description: string;
}

const TRANSITION_RULES: TransitionRule[] = [
  // IN_TRANSIT target
  { from: 'CREATED', to: 'IN_TRANSIT', allowed: true, roles: ['ADMIN', 'MANAGER'], description: 'Dispatch new trip' },
  { from: 'COMPLETED', to: 'IN_TRANSIT', allowed: true, roles: ['ADMIN', 'MANAGER'], description: 'Re-dispatch completed trip (direct reopen blocked — uses governed TRIP_REOPEN)' },
  { from: 'IN_TRANSIT', to: 'IN_TRANSIT', allowed: true, roles: [], description: 'Idempotent: same status short-circuit' },
  { from: 'CANCELED', to: 'IN_TRANSIT', allowed: false, roles: [], description: 'Cannot dispatch a canceled trip' },

  // COMPLETED target (from IN_TRANSIT — completion now carries the photo /
  // zero-revenue / e-POD gates and the POD-recovery gate formerly on
  // COMPLETED → LOCKED). A direct re-complete of COMPLETED is blocked.
  { from: 'IN_TRANSIT', to: 'COMPLETED', allowed: true, roles: ['ADMIN', 'MANAGER'], description: 'Complete a running trip through the governed close path; evidence gates are enforced' },
  // Direct COMPLETED → COMPLETED is blocked. A separate governed request applies
  // the exceptional reopen (COMPLETED → IN_TRANSIT) after maker/checker/approver
  // separation, after which the trip can be re-completed.
  { from: 'COMPLETED', to: 'COMPLETED', allowed: false, roles: [], description: 'Direct re-complete is blocked; use governed reopen approval (COMPLETED → IN_TRANSIT)' },
  { from: 'CREATED', to: 'COMPLETED', allowed: false, roles: [], description: 'Cannot complete a trip that was never dispatched' },
  { from: 'CANCELED', to: 'COMPLETED', allowed: false, roles: [], description: 'Cannot complete a canceled trip' },

  // CREATED target (no transitions lead TO CREATED — only idempotent same-status)
  { from: 'CREATED', to: 'CREATED', allowed: true, roles: [], description: 'Idempotent: same status short-circuit' },
  { from: 'IN_TRANSIT', to: 'CREATED', allowed: false, roles: [], description: 'Cannot revert a dispatched trip to CREATED' },
  { from: 'COMPLETED', to: 'CREATED', allowed: false, roles: [], description: 'Cannot revert a completed trip to CREATED' },
  { from: 'CANCELED', to: 'CREATED', allowed: false, roles: [], description: 'Cannot revert a canceled trip to CREATED' },

  // CANCELED target. A completed trip can be canceled only via a governed
  // request (TRIP_FINANCIAL_CHANGE / requestCompletedTripCancellation).
  { from: 'CREATED', to: 'CANCELED', allowed: true, roles: ['ADMIN', 'MANAGER'], description: 'Cancel a new trip' },
  { from: 'IN_TRANSIT', to: 'CANCELED', allowed: true, roles: ['ADMIN', 'MANAGER'], description: 'Cancel a running trip' },
  { from: 'COMPLETED', to: 'CANCELED', allowed: true, roles: ['ADMIN', 'MANAGER'], description: 'Cancel a completed trip (governed — requestCompletedTripCancellation)' },
  { from: 'CANCELED', to: 'CANCELED', allowed: true, roles: [], description: 'Idempotent: same status short-circuit' },
];

describe('Trip Status Machine — Transition Rules', () => {
  const ALL_STATUSES: Status[] = ['CREATED', 'IN_TRANSIT', 'COMPLETED', 'CANCELED'];

  test('all from→to combinations are covered', () => {
    // Every combination of (from, to) should appear in the rules
    const covered = new Set(TRANSITION_RULES.map(r => `${r.from}->${r.to}`));
    const missing: string[] = [];
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const key = `${from}->${to}`;
        if (!covered.has(key)) {
          missing.push(key);
        }
      }
    }
    assert.deepStrictEqual(missing, [], 'Missing transition rules');
  });

  test('no duplicate rules', () => {
    const keys = TRANSITION_RULES.map(r => `${r.from}->${r.to}`);
    const unique = new Set(keys);
    assert.strictEqual(keys.length, unique.size, 'Duplicate transition rules found');
  });

  for (const rule of TRANSITION_RULES) {
    if (!rule.allowed) {
      test(`BLOCKED: ${rule.from} → ${rule.to} (${rule.description})`, () => {
        assert.strictEqual(rule.allowed, false);
        // Verify the rule documents why it's blocked
        assert.ok(rule.description.length > 0, 'Blocked transition should have a description');
      });
    } else {
      test(`ALLOWED: ${rule.from} → ${rule.to} (${rule.description})`, () => {
        assert.strictEqual(rule.allowed, true);
      });
    }
  }
});

describe('Trip Status Machine — Role Permission Rules', () => {
  test('IN_TRANSIT dispatch requires ADMIN or MANAGER', () => {
    const dispatchRules = TRANSITION_RULES.filter(
      r => r.to === 'IN_TRANSIT' && r.from !== 'IN_TRANSIT' && r.allowed
    );
    for (const rule of dispatchRules) {
      assert.ok(
        rule.roles.includes('ADMIN') && rule.roles.includes('MANAGER'),
        `${rule.from}→IN_TRANSIT should require ADMIN/MANAGER`
      );
    }
  });

  test('COMPLETE requires ADMIN or MANAGER through governed approval', () => {
    const completeRules = TRANSITION_RULES.filter(
      r => r.to === 'COMPLETED' && r.from !== 'COMPLETED' && r.allowed
    );
    for (const rule of completeRules) {
      assert.ok(
        rule.roles.includes('ADMIN') && rule.roles.includes('MANAGER'),
        `${rule.from}→COMPLETED should allow ADMIN/MANAGER`
      );
    }
  });

  test('direct re-complete (COMPLETED→COMPLETED) is blocked', () => {
    const reCompleteRule = TRANSITION_RULES.find(r => r.from === 'COMPLETED' && r.to === 'COMPLETED');
    assert.ok(reCompleteRule, 'Missing COMPLETED→COMPLETED rule');
    assert.strictEqual(reCompleteRule.allowed, false);
  });

  test('CANCEL requires ADMIN or MANAGER', () => {
    const cancelRules = TRANSITION_RULES.filter(
      r => r.to === 'CANCELED' && r.from !== 'CANCELED' && r.allowed
    );
    for (const rule of cancelRules) {
      assert.ok(
        rule.roles.includes('ADMIN') && rule.roles.includes('MANAGER'),
        `${rule.from}→CANCELED should require ADMIN/MANAGER`
      );
    }
  });

  test('DRIVER role cannot dispatch, complete, or cancel', () => {
    const privilegedTransitions = TRANSITION_RULES.filter(
      r => r.allowed && r.roles.length > 0 && !r.roles.includes('DRIVER')
    );
    // Every privileged transition excludes DRIVER
    assert.ok(privilegedTransitions.length > 0, 'Should have some privileged transitions');
    for (const rule of privilegedTransitions) {
      assert.ok(!rule.roles.includes('DRIVER'), `${rule.from}→${rule.to} should not allow DRIVER`);
    }
  });

  test('ACCOUNTANT role cannot dispatch, complete, or cancel', () => {
    const privilegedTransitions = TRANSITION_RULES.filter(
      r => r.allowed && r.roles.length > 0 && !r.roles.includes('ACCOUNTANT')
    );
    assert.ok(privilegedTransitions.length > 0, 'Should have some privileged transitions');
    for (const rule of privilegedTransitions) {
      assert.ok(!rule.roles.includes('ACCOUNTANT'), `${rule.from}→${rule.to} should not allow ACCOUNTANT`);
    }
  });
});

describe('Trip Status Machine — Lifecycle Happy Path', () => {
  test('standard lifecycle: CREATED → IN_TRANSIT → COMPLETED', () => {
    const path: Status[] = ['CREATED', 'IN_TRANSIT', 'COMPLETED'];
    for (let i = 0; i < path.length - 1; i++) {
      const rule = TRANSITION_RULES.find(r => r.from === path[i] && r.to === path[i + 1]);
      assert.ok(rule, `Missing rule for ${path[i]}→${path[i + 1]}`);
      assert.strictEqual(rule.allowed, true, `${path[i]}→${path[i + 1]} should be allowed`);
    }
  });

  test('reopen lifecycle requires the separate governance workflow', () => {
    const directRecomplete = TRANSITION_RULES.find(r => r.from === 'COMPLETED' && r.to === 'COMPLETED');
    assert.ok(directRecomplete && !directRecomplete.allowed, 'direct COMPLETED→COMPLETED must be blocked');

    const reopen = TRANSITION_RULES.find(r => r.from === 'COMPLETED' && r.to === 'IN_TRANSIT');
    assert.ok(reopen && reopen.allowed, 'COMPLETED→IN_TRANSIT (governed reopen) must be allowed');
  });

  test('re-dispatch lifecycle: COMPLETED → IN_TRANSIT', () => {
    const redispatch = TRANSITION_RULES.find(r => r.from === 'COMPLETED' && r.to === 'IN_TRANSIT');
    assert.ok(redispatch && redispatch.allowed, 'COMPLETED→IN_TRANSIT (re-dispatch) must be allowed');
  });
});

// SIL-474 — "Chuyến future IN_TRANSIT chặn nhận lệnh". The enum has no
// ASSIGNED state, so an early "Xuất phát"/"Nhận lệnh" parks a future-departure
// trip in IN_TRANSIT. The truck-busy gate used to treat every IN_TRANSIT row
// as a running truck, freezing the vehicle for all other orders from today
// until the future departure date passed — while the completion rule (correct:
// ngày hoàn thành không thể trước ngày khởi hành) kept anyone from closing the
// future trip to free it. These tests pin the shared running-trip predicate:
// only rows whose departure day has arrived or passed may block.
describe('Truck availability gate — SIL-474 future IN_TRANSIT', () => {
  const TODAY = '2026-10-24'; // the day QA hit the deadlock (trip TVREQ-LX-C4 departs 2026-10-28)

  test('IN_TRANSIT with FUTURE departure day does not run — a new order is not blocked with 409', () => {
    assert.strictEqual(
      isTripRunningOnDepartureDay('2026-10-28', TODAY),
      false,
      'a future-departure IN_TRANSIT row is planning state, not a running truck',
    );
  });

  test('IN_TRANSIT with PAST departure day still runs — keep blocking (correct behavior preserved)', () => {
    assert.strictEqual(
      isTripRunningOnDepartureDay('2026-10-17', TODAY),
      true,
      'a genuinely running/stuck trip whose departure day passed must keep blocking',
    );
  });

  test('IN_TRANSIT departing TODAY runs — the normal started-trip case keeps blocking', () => {
    assert.strictEqual(isTripRunningOnDepartureDay('2026-10-24', TODAY), true);
  });

  test('legacy row without a departure date keeps the conservative block', () => {
    assert.strictEqual(isTripRunningOnDepartureDay(null, TODAY), true);
    assert.strictEqual(isTripRunningOnDepartureDay('', TODAY), true);
  });

  test('unreadable business clock keeps the conservative block', () => {
    assert.strictEqual(isTripRunningOnDepartureDay('2026-10-28', null), true);
    assert.strictEqual(isTripRunningOnDepartureDay('2026-10-28', undefined), true);
    assert.strictEqual(isTripRunningOnDepartureDay('2026-10-28', ''), true);
  });

  test('day-boundary sweep: the gate flips exactly on the departure day', () => {
    const departures = ['2026-10-23', '2026-10-24', '2026-10-25'];
    assert.deepStrictEqual(
      departures.map((d) => isTripRunningOnDepartureDay(d, TODAY)),
      [true, true, false],
      'lexicographic ISO-day comparison must flip exactly at departure day == today',
    );
  });

  test('the status machine busy loop actually consults the predicate', () => {
    // Wiring pin: the predicate only protects trips if the busy-trip loop in
    // transitionTripStatus keeps consulting it. Source-scan, no DB.
    const serviceSource = readFileSync(
      fileURLToPath(new URL('../../services/trip-status-machine.service.ts', import.meta.url)),
      'utf8',
    );
    assert.match(
      serviceSource,
      /isTripRunningOnDepartureDay\(candidate\.departureDate, todayInBusinessZone\)/,
      'the busy-trip loop must skip rows whose departure day has not arrived',
    );
    assert.match(
      serviceSource,
      /departureDate: s\.trips\.departureDate/,
      'the busy-trip select must carry the departure date for the running check',
    );
  });
});

// SIL-602 — "Lái xe chạy kẹp chỉ nhận được 1 lệnh". A valid KẸP pair must
// never block its own second leg: while leg 1 is IN_TRANSIT, accepting leg 2
// used to 409 with "Xe đang chạy chuyến…" whenever the exemption's extra
// `trailerId != null && equality` clause failed — and trailer data is NOT part
// of the pair contract (pairing validates same truck + same driver + same
// departure day + two 20ft shells; master-data imports legitimately leave the
// mooc unassigned, card 211026152138). PRD LoHangKepKetHop §3.2/§7.3: "KẸP
// hợp lệ không tự chặn công việc thứ hai vì xe bận trong chính cặp."
// The exemption is now the pure pair identity below: same ACTIVE KEP pair row
// (both legs still linked) + the shared driver. Deliberately not exempt: busy
// rows outside the pair, pair-link drift (pair broke / re-paired), and a
// driver mismatch (out-of-band drift stays blocking; reassign flows keep real
// pairs in sync). KET_HOP never resolves a partner (the status machine's
// lookup filters status='ACTIVE' + pairKind='KEP'), so its sequencing gate
// stays the sole owner of that pair kind.
describe('Truck availability gate — SIL-602 KẸP pair partner exemption', () => {
  // Accepting leg: trip 20, ACTIVE KEP pair 7, driver 5. The running busy row
  // is leg 1 (trip 11). The candidate shape carries NO trailer field at all —
  // the exemption must not depend on it, whether the mooc is unassigned
  // (null) on one/both legs or drifted between them; both PROD-shaped
  // variants are exercised through this one shape.
  const acceptingLeg = { tripId: 20, tripPairId: 7, tripDriverId: 5 };
  const partnerRow = { id: 11, activeTripPairId: 7, driverId: 5 };

  test('REG: the partner leg of the same ACTIVE KẸP pair is exempt even with an unassigned/drifted mooc — the second "Nhận lệnh" must not 409', () => {
    assert.strictEqual(
      isActiveKepPairPartner(partnerRow, { ...acceptingLeg, simultaneousPartnerId: 11 }),
      true,
      'a valid KẸP pair running together must never block its own second leg',
    );
  });

  test('a busy row outside the pair is never exempt', () => {
    const unpaired = { ...acceptingLeg, tripPairId: null, simultaneousPartnerId: null };
    assert.strictEqual(isActiveKepPairPartner(partnerRow, unpaired), false);
    assert.strictEqual(isActiveKepPairPartner(
      { id: 11, activeTripPairId: null, driverId: 5 },
      { ...acceptingLeg, simultaneousPartnerId: 11 },
    ), false,
    'a busy row that lost its pair link is a conflicting job, not the partner');
    // The KET_HOP / no-ACTIVE-KEP-pair shape at the predicate level: the trip
    // still carries a pair id, but no KEP partner resolved from it.
    assert.strictEqual(isActiveKepPairPartner(partnerRow, {
      ...acceptingLeg, simultaneousPartnerId: null,
    }), false,
    'without a resolved KEP partner the exemption must not fire (KẾT_HỢP keeps its sequencing gate)');
  });

  test('pair-link drift (busy row re-paired elsewhere) is never exempt', () => {
    assert.strictEqual(isActiveKepPairPartner(
      { id: 11, activeTripPairId: 99, driverId: 5 },
      { ...acceptingLeg, simultaneousPartnerId: 11 },
    ), false,
    'the busy row must still carry the SAME pair id as the accepting leg');
  });

  test('a driver mismatch on the partner is never exempt', () => {
    assert.strictEqual(isActiveKepPairPartner(
      { id: 11, activeTripPairId: 7, driverId: 6 },
      { ...acceptingLeg, simultaneousPartnerId: 11 },
    ), false,
    'out-of-band driver drift stays blocking; guarded reassign flows keep real pairs in sync');
  });

  test('a same-pair row that is not the resolved simultaneous partner is never exempt', () => {
    assert.strictEqual(isActiveKepPairPartner(
      { id: 12, activeTripPairId: 7, driverId: 5 },
      { ...acceptingLeg, simultaneousPartnerId: 11 },
    ), false);
  });

  test('the accepting leg itself (no pair, no driver) resolves nothing', () => {
    assert.strictEqual(isActiveKepPairPartner(partnerRow, {
      tripId: 20, tripPairId: 7, tripDriverId: null, simultaneousPartnerId: 11,
    }), false);
  });

  test('wiring pins: the busy loop uses the predicate, the trailer clause is gone, and the KEP-only pair lookup stays', () => {
    const serviceSource = readFileSync(
      fileURLToPath(new URL('../../services/trip-status-machine.service.ts', import.meta.url)),
      'utf8',
    );
    assert.match(
      serviceSource,
      /isActiveKepPairPartner\(candidate, \{[\s\S]*?tripId,[\s\S]*?tripPairId: trip\.activeTripPairId,[\s\S]*?tripDriverId: trip\.driverId,[\s\S]*?simultaneousPartnerId,[\s\S]*?\}\)/,
      'the busy-trip loop must consult the shared KẸP-partner predicate',
    );
    assert.doesNotMatch(
      serviceSource,
      /trip\.trailerId != null && candidate\.trailerId === trip\.trailerId/,
      'the superseded trailerId clause is exactly the SIL-602 regression — it must stay gone',
    );
    assert.match(
      serviceSource,
      /activeTripPairId: s\.trips\.activeTripPairId,\s*\n\s*driverId: s\.trips\.driverId,/,
      'the busy-trip select must keep carrying the pair id and driver for the exemption',
    );
    assert.match(
      serviceSource,
      /eq\(s\.tripPairs\.status, 'ACTIVE'\),\s*\n\s*eq\(s\.tripPairs\.pairKind, 'KEP'\),/,
      'the partner resolution must stay scoped to ACTIVE KEP pairs — KẾT_HỢP keeps its sequencing gate',
    );
  });
});
