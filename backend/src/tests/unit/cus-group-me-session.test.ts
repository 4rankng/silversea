// AC1 (ticket 18/11) — the /auth/me session letter carries a CUS user's
// ACTIVE nhóm CUS. The route handler has no HTTP-level harness in this suite
// (no live Postgres), so the join law is pinned on the service with a fake
// executor and the route's wiring with a source pin — the same two-layer
// pattern the unit suite uses elsewhere.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import { listActiveCusGroupsForUser } from '../../services/cus-group.service';

const dialect = new PgDialect();

function render(chunk: SQL): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(chunk);
}

interface SeenChain {
  conditions: unknown[];
}

/** Fake executor for the mine→groups join: captures the WHERE condition and
 *  resolves the awaited orderBy chain with `rows` (drizzle builders are
 *  thenable). */
function fakeGroupExecutor(rows: Array<{ id: number; name: string }>, seen: SeenChain) {
  const chain = {
    innerJoin: () => chain,
    where: (condition: unknown) => { seen.conditions.push(condition); return chain; },
    orderBy: () => ({
      then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(onFulfilled, onRejected),
    }),
  };
  return {
    select: () => ({ from: () => chain }),
  } as never;
}

describe('listActiveCusGroupsForUser — /me session letter join', () => {
  it('trả đúng {id, name} của các nhóm ACTIVE user thuộc vào', async () => {
    const seen: SeenChain = { conditions: [] };
    const groups = await listActiveCusGroupsForUser(7, fakeGroupExecutor([
      { id: 2, name: 'Nhóm Hải Phòng' },
      { id: 1, name: 'Nhóm Hà Nội' },
    ], seen));
    assert.deepEqual(groups, [
      { id: 2, name: 'Nhóm Hải Phòng' },
      { id: 1, name: 'Nhóm Hà Nội' },
    ]);
    // The join must filter on the user's membership AND ACTIVE status — an
    // INACTIVE group never reaches the session letter.
    assert.equal(seen.conditions.length, 1);
    const { sql, params } = render(seen.conditions[0] as SQL);
    assert.match(sql, /"cus_group_members"\."user_id" = \$1/);
    assert.match(sql, /"cus_groups"\."status" = \$2/);
    assert.deepEqual(params, [7, 'ACTIVE']);
  });

  it('người không thuộc nhóm nào → [] (FE đọc custoGroups rỗng, không lỗi)', async () => {
    const groups = await listActiveCusGroupsForUser(8, fakeGroupExecutor([], { conditions: [] }));
    assert.deepEqual(groups, []);
  });

  // Route wiring pin: GET /me attaches the array only for role CUS; the
  // login response stays untouched (additive field law, ticket 18/11).
  it('GET /me gắn cusGroups cho đúng vai CUS qua service ACTIVE lookup', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../routes/auth.ts'), 'utf8');
    const meHandler = source.slice(source.indexOf("router.get('/me'"), source.indexOf("router.post('/logout'"));
    assert.match(meHandler, /cusGroups: profile\.role === Role\.CUS\n\s*\?\ await cusGroupService\.listActiveCusGroupsForUser\(getUser\(req\)\.userId\)\n\s*:\s*\[\]/);
    // The login handler never carries the field (additive to /me only).
    const loginHandler = source.slice(source.indexOf("router.post('/login'"), source.indexOf("router.get('/me'"));
    assert.ok(!loginHandler.includes('cusGroups'));
  });
});
