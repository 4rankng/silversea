// Catalog integrity tests for the curated tour engine. Run via tsx (shared/
// test files are intentionally excluded from tsc — see shared-tests-tsc-blindspot).
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { TOUR_CATALOG, TOUR_IDS, toursForRole } from './catalog.ts';
import { AGENT_ROUTE_KEYS } from '../schemas/agent.ts';
import { Role } from '../constants/index.ts';
import { PRODUCT_EVENTS } from '../onboarding/events.ts';

const ROUTE_KEYS = new Set<string>(AGENT_ROUTE_KEYS);

/** Collect every routeKey a tour step navigates/focuses to. */
function stepRouteKeys(tourId: string): string[] {
  const out: string[] = [];
  for (const step of TOUR_CATALOG[tourId].steps) {
    const d = step.directive;
    if (d && (d.kind === 'navigate' || d.kind === 'focus')) out.push(d.routeKey);
  }
  return out;
}

describe('tour catalog integrity', () => {
  test('every step routeKey is a known agent route key', () => {
    for (const id of TOUR_IDS) {
      for (const rk of stepRouteKeys(id)) {
        assert.ok(ROUTE_KEYS.has(rk), `tour "${id}" references unknown routeKey "${rk}"`);
      }
    }
  });

  test('every tour has >=1 role and 2-10 non-empty steps', () => {
    for (const id of TOUR_IDS) {
      const t = TOUR_CATALOG[id];
      assert.ok(t.roles.length >= 1, `tour "${id}" has no roles`);
      assert.ok(t.steps.length >= 2 && t.steps.length <= 10, `tour "${id}" has ${t.steps.length} steps`);
      for (const s of t.steps) {
        assert.ok(s.title.trim(), `tour "${id}" has a step with an empty title`);
        assert.ok(s.body.trim(), `tour "${id}" step "${s.title}" has an empty body`);
      }
    }
  });

  test('every tour has a positive-integer version (Phase 2 versioning)', () => {
    for (const id of TOUR_IDS) {
      const t = TOUR_CATALOG[id];
      assert.ok(
        Number.isInteger(t.version) && t.version >= 1,
        `tour "${id}" has invalid version ${String(t.version)} (must be a positive integer)`,
      );
    }
  });

  test('every completionEvent is a known product event (Phase 3 interaction steps)', () => {
    const known = new Set<string>(PRODUCT_EVENTS);
    for (const id of TOUR_IDS) {
      for (const s of TOUR_CATALOG[id].steps) {
        if (s.completionEvent) {
          assert.ok(
            known.has(s.completionEvent),
            `tour "${id}" step "${s.title}" has unknown completionEvent "${s.completionEvent}"`,
          );
        }
      }
    }
  });

  test('create-trip final step is the canonical interaction step (Phase 3)', () => {
    const last = TOUR_CATALOG['create-trip'].steps[TOUR_CATALOG['create-trip'].steps.length - 1];
    assert.strictEqual(last.completionEvent, 'trip.created', 'create-trip last step must complete on trip.created');
  });

  test('toursForRole is role-scoped', () => {
    assert.strictEqual(toursForRole(Role.DRIVER).length, 0, 'DRIVER sees no office tours');
    assert.strictEqual(toursForRole(Role.FORWARDER).length, 0, 'FORWARDER sees no office tours');
    const acct = toursForRole(Role.ACCOUNTANT)
      .map((t) => t.id)
      .sort();
    assert.deepStrictEqual(acct, ['accounting-overview', 'fuel-config', 'record-receivable-payment', 'review-pnl', 'update-trip-figures']);
    assert.strictEqual(toursForRole(Role.MANAGER).length, 8);
    assert.strictEqual(toursForRole(Role.ADMIN).length, 12);
  });

  test('fuel-config tour preserves the original spotlight targetIds', () => {
    const t = TOUR_CATALOG['fuel-config'];
    const targetIds: string[] = [];
    for (const s of t.steps) {
      const d = s.directive;
      if (!d) continue;
      if (d.kind === 'scrollTo') targetIds.push(d.targetId);
      else if (d.kind === 'navigate' && d.highlight) targetIds.push(d.highlight.targetId);
    }
    for (const expected of [
      'fuel-loaded-norm-field',
      'fuel-empty-norm-field',
      'fuel-supplement-field',
      'fuel-unit-price-field',
      'fuel-save-config-button',
    ]) {
      assert.ok(targetIds.includes(expected), `fuel-config tour lost targetId "${expected}"`);
    }
  });

  test('create-trip tour starts with navigation then targets the required TripNew controls', () => {
    const t = TOUR_CATALOG['create-trip'];
    const first = t.steps[0].directive;
    assert.ok(first && first.kind === 'navigate', 'create-trip must open the trip-create page first');
    assert.strictEqual(first.highlight, undefined, 'create-trip must not spotlight the entire form');
    const ids: string[] = [];
    for (const s of t.steps) {
      const d = s.directive;
      if (!d) continue;
      if (d.kind === 'scrollTo') ids.push(d.targetId);
      else if (d.kind === 'navigate' && d.highlight) ids.push(d.highlight.targetId);
    }
    assert.ok(ids.includes('trip-new-submit'), 'create-trip tour must spotlight the submit button');
    assert.ok(ids.includes('customerId'), 'create-trip tour must spotlight the customer selector');
    assert.ok(ids.includes('routeId'), 'create-trip tour must spotlight the route selector');
    assert.ok(!ids.includes('trip-new-form'), 'create-trip tour must not spotlight the full form');
  });
});
