// SIL-1346 (audit 28/11) — the Tháng chip scopes the journey board
// server-side. The wire contract: absent params keep the unscooped board
// (backward compatibility), a valid month/year pair parses, and anything
// else is a 400 the driver app surfaces as an error state — never a silently
// unscoped board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDriverJourneyMonthScope } from '../../services/driver-journey-board.service.js';

test('absent params keep the board unscooped', () => {
  assert.equal(parseDriverJourneyMonthScope(undefined, undefined), null);
});

test('a valid month/year pair parses to the scope', () => {
  assert.deepEqual(parseDriverJourneyMonthScope('11', '2026'), { month: 11, year: 2026 });
});

test('out-of-range or non-numeric params are rejected', () => {
  assert.throws(() => parseDriverJourneyMonthScope('0', '2026'));
  assert.throws(() => parseDriverJourneyMonthScope('13', '2026'));
  assert.throws(() => parseDriverJourneyMonthScope('11', '1999'));
  assert.throws(() => parseDriverJourneyMonthScope('11', '2101'));
  assert.throws(() => parseDriverJourneyMonthScope('eleven', '2026'));
  assert.throws(() => parseDriverJourneyMonthScope('11', undefined));
  assert.throws(() => parseDriverJourneyMonthScope(undefined, '2026'));
});
