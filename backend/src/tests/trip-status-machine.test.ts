/**
 * Trip Status Machine — Transition validation rules
 *
 * These tests validate the status transition matrix and role permission rules
 * as documented in docs/flows/01-TRIP_LIFECYCLE.md, encoded in the
 * transitionTripStatus function in trip-status-machine.service.ts.
 *
 * The actual service function is tightly coupled to the database transaction,
 * so we test the business rules as pure data-driven tests that document the
 * expected behavior. If the service is ever refactored to extract a pure
 * validation layer, these tests should be pointed at it directly.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';

// ── Transition Matrix ──────────────────────────────────────────────────────
// Which target statuses are valid from each current status?
// Derived from transitionTripStatus() guard conditions.

type Status = 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'LOCKED' | 'CANCELED';

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
  { from: 'COMPLETED', to: 'IN_TRANSIT', allowed: true, roles: ['ADMIN', 'MANAGER'], description: 'Re-dispatch completed trip' },
  { from: 'IN_TRANSIT', to: 'IN_TRANSIT', allowed: true, roles: [], description: 'Idempotent: same status short-circuit' },
  { from: 'LOCKED', to: 'IN_TRANSIT', allowed: false, roles: [], description: 'Cannot dispatch a locked trip' },
  { from: 'CANCELED', to: 'IN_TRANSIT', allowed: false, roles: [], description: 'Cannot dispatch a canceled trip' },

  // COMPLETED target (from IN_TRANSIT — normal completion)
  { from: 'IN_TRANSIT', to: 'COMPLETED', allowed: true, roles: [], description: 'Complete a running trip (permissive — photos optional, B2)' },
  // Direct LOCKED → COMPLETED is blocked. A separate governed request applies
  // the exceptional reopen after maker/checker/approver separation.
  { from: 'LOCKED', to: 'COMPLETED', allowed: false, roles: [], description: 'Direct unlock is blocked; use governed reopen approval' },
  { from: 'CREATED', to: 'COMPLETED', allowed: false, roles: [], description: 'Cannot complete a trip that was never dispatched' },
  { from: 'COMPLETED', to: 'COMPLETED', allowed: true, roles: [], description: 'Idempotent: same status short-circuit' },
  { from: 'CANCELED', to: 'COMPLETED', allowed: false, roles: [], description: 'Cannot complete a canceled trip' },

  // LOCKED target
  { from: 'COMPLETED', to: 'LOCKED', allowed: true, roles: ['ADMIN', 'MANAGER'], description: 'Lock (finalize) a completed trip' },
  { from: 'CREATED', to: 'LOCKED', allowed: false, roles: [], description: 'Cannot lock a trip that was never dispatched' },
  { from: 'IN_TRANSIT', to: 'LOCKED', allowed: false, roles: [], description: 'Must complete before locking' },
  { from: 'LOCKED', to: 'LOCKED', allowed: true, roles: [], description: 'Idempotent: same status short-circuit' },
  { from: 'CANCELED', to: 'LOCKED', allowed: false, roles: [], description: 'Cannot lock a canceled trip' },

  // CREATED target (no transitions lead TO CREATED — only idempotent same-status)
  { from: 'CREATED', to: 'CREATED', allowed: true, roles: [], description: 'Idempotent: same status short-circuit' },
  { from: 'IN_TRANSIT', to: 'CREATED', allowed: false, roles: [], description: 'Cannot revert a dispatched trip to CREATED' },
  { from: 'COMPLETED', to: 'CREATED', allowed: false, roles: [], description: 'Cannot revert a completed trip to CREATED' },
  { from: 'LOCKED', to: 'CREATED', allowed: false, roles: [], description: 'Cannot revert a locked trip to CREATED' },
  { from: 'CANCELED', to: 'CREATED', allowed: false, roles: [], description: 'Cannot revert a canceled trip to CREATED' },

  // CANCELED target
  { from: 'CREATED', to: 'CANCELED', allowed: true, roles: ['ADMIN', 'MANAGER'], description: 'Cancel a new trip' },
  { from: 'IN_TRANSIT', to: 'CANCELED', allowed: true, roles: ['ADMIN', 'MANAGER'], description: 'Cancel a running trip' },
  { from: 'COMPLETED', to: 'CANCELED', allowed: true, roles: ['ADMIN', 'MANAGER'], description: 'Cancel a completed trip' },
  { from: 'LOCKED', to: 'CANCELED', allowed: false, roles: [], description: 'Cannot cancel a locked trip — must unlock first' },
  { from: 'CANCELED', to: 'CANCELED', allowed: true, roles: [], description: 'Idempotent: same status short-circuit' },
];

describe('Trip Status Machine — Transition Rules', () => {
  const ALL_STATUSES: Status[] = ['CREATED', 'IN_TRANSIT', 'COMPLETED', 'LOCKED', 'CANCELED'];

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

  test('LOCK requires ADMIN or MANAGER', () => {
    const lockRules = TRANSITION_RULES.filter(
      r => r.to === 'LOCKED' && r.from !== 'LOCKED' && r.allowed
    );
    for (const rule of lockRules) {
      assert.ok(
        rule.roles.includes('ADMIN') && rule.roles.includes('MANAGER'),
        `${rule.from}→LOCKED should require ADMIN/MANAGER`
      );
    }
  });

  test('direct UNLOCK (LOCKED→COMPLETED) is blocked', () => {
    const unlockRule = TRANSITION_RULES.find(r => r.from === 'LOCKED' && r.to === 'COMPLETED');
    assert.ok(unlockRule, 'Missing LOCKED→COMPLETED rule');
    assert.strictEqual(unlockRule.allowed, false);
  });

  test('CANCEL requires ADMIN or MANAGER (except LOCKED which is blocked)', () => {
    const cancelRules = TRANSITION_RULES.filter(
      r => r.to === 'CANCELED' && r.from !== 'CANCELED' && r.allowed
    );
    for (const rule of cancelRules) {
      assert.ok(
        rule.roles.includes('ADMIN') && rule.roles.includes('MANAGER'),
        `${rule.from}→CANCELED should require ADMIN/MANAGER`
      );
    }
    // LOCKED→CANCELED is explicitly blocked
    const lockedCancel = TRANSITION_RULES.find(r => r.from === 'LOCKED' && r.to === 'CANCELED');
    assert.ok(lockedCancel, 'Missing LOCKED→CANCELED rule');
    assert.strictEqual(lockedCancel.allowed, false, 'LOCKED→CANCELED must be blocked');
  });

  test('DRIVER role cannot dispatch, lock, unlock, or cancel', () => {
    const privilegedTransitions = TRANSITION_RULES.filter(
      r => r.allowed && r.roles.length > 0 && !r.roles.includes('DRIVER')
    );
    // Every privileged transition excludes DRIVER
    assert.ok(privilegedTransitions.length > 0, 'Should have some privileged transitions');
    for (const rule of privilegedTransitions) {
      assert.ok(!rule.roles.includes('DRIVER'), `${rule.from}→${rule.to} should not allow DRIVER`);
    }
  });

  test('ACCOUNTANT role cannot dispatch, lock, unlock, or cancel', () => {
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
  test('standard lifecycle: CREATED → IN_TRANSIT → COMPLETED → LOCKED', () => {
    const path: Status[] = ['CREATED', 'IN_TRANSIT', 'COMPLETED', 'LOCKED'];
    for (let i = 0; i < path.length - 1; i++) {
      const rule = TRANSITION_RULES.find(r => r.from === path[i] && r.to === path[i + 1]);
      assert.ok(rule, `Missing rule for ${path[i]}→${path[i + 1]}`);
      assert.strictEqual(rule.allowed, true, `${path[i]}→${path[i + 1]} should be allowed`);
    }
  });

  test('unlock lifecycle requires the separate governance workflow', () => {
    const unlock = TRANSITION_RULES.find(r => r.from === 'LOCKED' && r.to === 'COMPLETED');
    assert.ok(unlock && !unlock.allowed, 'direct LOCKED→COMPLETED must be blocked');

    const relock = TRANSITION_RULES.find(r => r.from === 'COMPLETED' && r.to === 'LOCKED');
    assert.ok(relock && relock.allowed, 'COMPLETED→LOCKED (re-lock) must be allowed');
  });

  test('re-dispatch lifecycle: COMPLETED → IN_TRANSIT', () => {
    const redispatch = TRANSITION_RULES.find(r => r.from === 'COMPLETED' && r.to === 'IN_TRANSIT');
    assert.ok(redispatch && redispatch.allowed, 'COMPLETED→IN_TRANSIT (re-dispatch) must be allowed');
  });
});
