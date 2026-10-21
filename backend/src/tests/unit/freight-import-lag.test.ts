// Unit tests — resolveImportedFuelLag decision table (R31 freight-04,
// cards 211026221918). Pure logic: no db, no app bootstrap.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveImportedFuelLag } from '../../services/freight-import-lag';

test('file lag wins and counts as customer confirmation', () => {
  assert.deepEqual(
    resolveImportedFuelLag(1, { fuelLagDays: 0, fuelLagConfirmed: false }),
    { fuelLagDays: 1, fuelLagConfirmed: true, carriedForward: false },
  );
  assert.deepEqual(
    resolveImportedFuelLag(0, { fuelLagDays: 1, fuelLagConfirmed: true }),
    { fuelLagDays: 0, fuelLagConfirmed: true, carriedForward: false },
  );
});

test('omitted lag carries the current terms forward (NEWEB keeps lag 1, confirmed)', () => {
  // The regression that produced QA card 211026221918: an Excel without a
  // "Lag Day n" cell must not reset a confirmed NEWEB lag=1 to 0/confirmed.
  assert.deepEqual(
    resolveImportedFuelLag(null, { fuelLagDays: 1, fuelLagConfirmed: true }),
    { fuelLagDays: 1, fuelLagConfirmed: true, carriedForward: true },
  );
  assert.deepEqual(
    resolveImportedFuelLag(undefined, { fuelLagDays: 1, fuelLagConfirmed: true }),
    { fuelLagDays: 1, fuelLagConfirmed: true, carriedForward: true },
  );
});

test('omitted lag keeps an UNconfirmed terms row unconfirmed (surcharge-pending path)', () => {
  // ASKEY/SUNRISE+SJ lag is not customer-confirmed; an import must not
  // silently confirm it (PRD §3.1: report the missing term, don't use 0).
  assert.deepEqual(
    resolveImportedFuelLag(null, { fuelLagDays: 0, fuelLagConfirmed: false }),
    { fuelLagDays: 0, fuelLagConfirmed: false, carriedForward: true },
  );
});

test('first-ever terms with no file lag lands on 0 NOT confirmed — never a fabricated confirmation', () => {
  assert.deepEqual(
    resolveImportedFuelLag(null, null),
    { fuelLagDays: 0, fuelLagConfirmed: false, carriedForward: false },
  );
  assert.deepEqual(
    resolveImportedFuelLag(undefined, undefined),
    { fuelLagDays: 0, fuelLagConfirmed: false, carriedForward: false },
  );
});

test('non-integer file lag is treated as omitted (carry-forward) — never a fabricated confirmed-0 from "0.5 ngày"', () => {
  assert.deepEqual(
    resolveImportedFuelLag(0.5, { fuelLagDays: 1, fuelLagConfirmed: true }),
    { fuelLagDays: 1, fuelLagConfirmed: true, carriedForward: true },
  );
  assert.equal(
    resolveImportedFuelLag(Number.NaN, { fuelLagDays: 2, fuelLagConfirmed: true }).carriedForward,
    true,
  );
  assert.equal(
    resolveImportedFuelLag(null, { fuelLagDays: -3, fuelLagConfirmed: true }).fuelLagDays,
    0,
  );
});
