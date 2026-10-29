// SIL-594 (id 694) — the API response is live operational state: every /api
// response must carry Cache-Control: no-store so no browser session cache or
// intermediary proxy (the staging nginx) can replay pre-save bytes to a
// read-after-write refetch. Pure handler test — no express boot (BE unit law).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// Review finding 5 — the handler alone can't prove the MOUNT: dropping
// `app.use('/api', apiNoStore)` from index.ts would stay green. Pin the wiring
// with a filesystem-only source scan (the report-cache-registry convention):
// the no-store mount must exist and be the FIRST bare '/api' mount.
test('SIL-594-C4 wiring: index.ts mounts apiNoStore on /api before every route mount', () => {
  const src = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8');
  const apiMounts = [...src.matchAll(/app\.use\((['"])\/api\1/g)].map((match) => match.index ?? 0);
  const own = src.indexOf("app.use('/api', apiNoStore)");
  assert.ok(own >= 0, "index.ts must mount apiNoStore on '/api'");
  assert.ok(apiMounts.length > 0, 'index.ts must mount /api consumers');
  assert.equal(own, Math.min(...apiMounts), "apiNoStore must be the FIRST '/api' mount");
});
