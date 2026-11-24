import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distinctTripReferences, tripBusinessReference } from '../../services/trip-run-shape';

// The fleet-productivity daily grid names runs by their business key
// (KB §1.4.3 / V25): the Bill/Booking dispatch persisted on the trip —
// never the internal TRP-* code, and never a made-up fallback token.

test('tripBusinessReference keeps the trimmed Bill/Booking', () => {
  assert.equal(tripBusinessReference('BL-LM-2026-001'), 'BL-LM-2026-001');
  assert.equal(tripBusinessReference('  BL-LM-2026-001  '), 'BL-LM-2026-001');
});

test('tripBusinessReference says a trip without a reference instead of inventing one', () => {
  for (const missing of [null, undefined, '', '   ']) {
    assert.equal(tripBusinessReference(missing), 'Chưa có số Bill/Booking');
  }
});

test('distinctTripReferences collapses paired runs of one Bill, keeping first-seen order', () => {
  // A truck's day: 2 runs on one Bill (kẹp pair) + 1 run on another + 1
  // reference-less run. The chips read [A, B, Chưa có số Bill/Booking] while
  // the run counts stay 4 in the numeric columns.
  const runs = ['BL-A', 'BL-A', 'BL-B', 'Chưa có số Bill/Booking'];
  assert.deepEqual(distinctTripReferences(runs, (reference) => reference), [
    'BL-A',
    'BL-B',
    'Chưa có số Bill/Booking',
  ]);
});

test('distinctTripReferences returns an empty list for an idle truck', () => {
  assert.deepEqual(distinctTripReferences([], (reference) => reference), []);
});
