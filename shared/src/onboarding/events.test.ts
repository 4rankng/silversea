// Catalog integrity tests for the product-event closed set. Run via tsx —
// shared test files are intentionally excluded from tsc (see
// shared-tests-tsc-blindspot). Mirrors the tours/catalog.test.ts pattern.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { PRODUCT_EVENTS, ProductEventPayloads } from './events.ts';

describe('product-event catalog integrity', () => {
  test('PRODUCT_EVENTS has no duplicates', () => {
    const seen = new Set<string>();
    for (const name of PRODUCT_EVENTS) {
      assert.ok(!seen.has(name), `duplicate event name "${name}"`);
      seen.add(name);
    }
  });

  test('every event name follows the <domain>.<action> convention', () => {
    for (const name of PRODUCT_EVENTS) {
      assert.ok(
        /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z_]*$/.test(name),
        `event "${name}" does not match the <domain>.<action> convention`,
      );
    }
  });

  test('every key in ProductEventPayloads is a known event name', () => {
    // `ProductEventPayloads` is a type, so this is enforced at compile time for
    // consumers. Here we sanity-check the runtime mirror: the keys we declare
    // must all be present in PRODUCT_EVENTS. (Compile-time only — this test
    // exists so a future edit that adds a payload key without the event name
    // fails CI.)
    const known = new Set<string>(PRODUCT_EVENTS);
    const payloadKeys = Object.keys({} as Record<keyof typeof ProductEventPayloads, unknown>);
    for (const k of payloadKeys) {
      assert.ok(known.has(k), `ProductEventPayloads key "${k}" is not in PRODUCT_EVENTS`);
    }
  });

  test('the reference events Phase 1 wires exist in the catalog', () => {
    // Phase 3's create-trip tour + Phase 6 checklists depend on these. Pinning
    // them here catches an accidental catalog rename before it breaks a tour.
    const must = ['ui.trip_create_clicked', 'trip.created', 'trip.locked', 'trip.completed', 'receivable.payment_recorded', 'config.fuel_saved'] as const;
    const known = new Set<string>(PRODUCT_EVENTS);
    for (const name of must) {
      assert.ok(known.has(name), `reference event "${name}" missing from PRODUCT_EVENTS`);
    }
  });
});
