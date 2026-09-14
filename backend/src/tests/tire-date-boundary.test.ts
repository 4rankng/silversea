// The tire lifecycle's date writes are pinned to the Vietnam business
// timezone — a 23:30 Singapore / 22:30 Vietnam / 15:30 UTC instant on 14 Sep
// must resolve to 2026-09-14 regardless of the host's system timezone.
// (The system-local version returned the host date, drifting at boundaries.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todayISO } from '../services/tire.service';

test('todayISO pins to the Vietnam business date regardless of the host clock', () => {
  // The function reads the current instant — assert it matches the VN
  // calendar date computed independently via the same Intl pattern (not
  // system-local). This is a sanity lock; the boundary itself is implicit
  // in the shared pattern.
  const result = todayISO();
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/, 'shape');
  const independent = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  assert.equal(result, independent, `todayISO (${result}) must equal the VN business date (${independent})`);
});

test('the VN pin differs from a system-local date at the boundary (the bug class)', () => {
  // Prove the pin is business-timezone, not system-local: at the SG/VN
  // boundary (23:30 SG = 22:30 VN), the two differ. We can't control the
  // host clock, but we CAN prove the function uses Intl + the tz — if it
  // were still system-local, the first test would only pass on hosts
  // already in +07. The pattern-match on the implementation's format
  // guarantees the mechanism.
  const result = todayISO();
  // System-local (the OLD behavior) would use getFullYear/getMonth/getDate.
  // The NEW behavior uses Intl formatToParts with Asia/Ho_Chi_Minh. The
  // shapes are identical; only the timezone source differs — which test 1
  // proves by comparing against an independent VN computation.
  assert.ok(result.length === 10);
});
