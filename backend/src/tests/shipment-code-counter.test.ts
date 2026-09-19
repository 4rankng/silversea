// Shipment codes are allocated from an independent per-month counter
// (ruling 4b): codes never derive from the row id, and concurrent creates
// serialize through an advisory lock + a single counter row per year-month.
// The unique shipmentCode index remains the collision backstop.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { db, client } from '../db';
import { allocateShipmentCode } from '../services/shipment-create.service';
import { disconnectRedis } from '../lib/redis';

after(async () => {
  await client.end();
  await disconnectRedis();
});

describe('shipment code independent counter', () => {
  test('parallel allocations in one month stay unique, format-correct and sequential', async () => {
    const N = 8;
    const codes = await Promise.all(Array.from({ length: N }, () =>
      db.transaction(async (tx) => allocateShipmentCode(tx, new Date())),
    ));

    assert.equal(new Set(codes).size, N, 'concurrent creates never collide');
    const now = new Date();
    const prefix = `SHP-${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}-`;
    for (const code of codes) {
      assert.match(code, /^SHP-\d{4}-\d{5}$/, `format ${code}`);
      assert.ok(code.startsWith(prefix), `${code} belongs to the current month`);
    }

    // The advisory lock serializes the 8 allocations, so their counters are
    // a contiguous window — no gaps created by this test alone.
    const tails = codes.map((code) => Number.parseInt(code.slice(-5), 10)).sort((a, b) => a - b);
    for (let i = 1; i < tails.length; i += 1) {
      assert.equal(tails[i], tails[0] + i, `counter advances sequentially: ${tails[i - 1]} -> ${tails[i]}`);
    }
  });

  test('a different month gets its own counter stream', async () => {
    const october = new Date('2026-10-15T10:00:00Z');
    const code = await db.transaction(async (tx) => allocateShipmentCode(tx, october));
    assert.ok(code.startsWith('SHP-2610-'), `cross-month stream: ${code}`);
    assert.match(code, /^SHP-2610-\d{5}$/);
  });
});
