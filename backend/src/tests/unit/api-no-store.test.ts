// SIL-594 (id 694) — the API response is live operational state: every /api
// response must carry Cache-Control: no-store so no browser session cache or
// intermediary proxy (the staging nginx) can replay pre-save bytes to a
// read-after-write refetch. Pure handler test — no express boot (BE unit law).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiNoStore } from '../../middleware/api-no-store';

test('SIL-594-C4: apiNoStore sets Cache-Control: no-store and continues', () => {
  const headers: Record<string, string> = {};
  let nextCalls = 0;
  const res = {
    set(key: string, value: string) {
      headers[key] = value;
    },
  };
  apiNoStore({} as never, res as never, () => {
    nextCalls += 1;
  });

  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(nextCalls, 1);
});
