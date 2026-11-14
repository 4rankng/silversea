// SIL-823 (id 952) — the /users 'Chỉnh sửa lái xe' form has no phone field; a
// stale `phone: ''` echo silently cleared drivers.phone on every save (real
// case: Bùi Tiến Dũng, Muse restored by hand via /fleet). The frontend now
// sends a partial payload; this file pins the backend PATCH contract the fix
// relies on — users.phone and drivers.phone are written ONLY when the request
// explicitly carries `phone`, absence never clears. Per the BE unit-only
// ruling (da4d2f0b) this is a source-scan pin (precedent: sil812).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const service = readFileSync(
  path.resolve(process.cwd(), 'src/services/user.service.ts'),
  'utf8',
);

test('SIL-823 — buildDriverUpdateSet writes drivers.phone only on an explicit phone field', () => {
  const start = service.indexOf('function buildDriverUpdateSet');
  const end = service.indexOf('/** Update user fields.', start);
  const fn = service.slice(start, end);
  assert.match(
    fn,
    /if \(data\.phone !== undefined\) set\.phone = data\.phone \|\| null/,
    'the drivers.phone write stays presence-gated',
  );
  // Exactly the type annotation + gate/assignment mentions — any extra
  // occurrence is a new statement deriving or clearing phone (the data-loss
  // echo path this ticket removes).
  assert.equal((fn.match(/phone/g) ?? []).length, 4);
});

test('SIL-823 — the users-table phone write is gated the same way (absent phone never clears)', () => {
  assert.match(
    service,
    /if \(data\.phone !== undefined\) updates\.phone = data\.phone \|\| null/,
    'absence of phone in the PATCH body must leave users.phone untouched',
  );
});
