/**
 * Card 20260928_166 AC1 — bulk vehicle → kế toán phơi phiếu assignment.
 * The PM's split is 2 accountants over 39 trucks (13/26), so the write has to
 * do many trucks in ONE action; the single-truck lifecycle already exists and is
 * pinned by `card8-truck-assignments.test.ts` (AC3/AC4 live there — not
 * re-implemented here).
 *
 * What this suite pins:
 *   - one call assigns many trucks, one ACTIVE row each;
 *   - re-sending the same batch is a no-op (no history churn, retry-safe);
 *   - all-or-nothing: a bad truck in the batch leaves NOTHING written;
 *   - a re-split keeps the previous row as history (`endedAt`), never deletes it;
 *   - a repeated truck id in one request is processed once.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { assignTruckAccountantsBatch } from '../services/expense-accounting-write.service';
import { listPhoiPhieuTruckAssignments } from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const plateSeed = Date.now() % 100000000;

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

async function mkActor(role: 'ACCOUNTANT' | 'ADMIN') {
  const [u] = await db.insert(s.users).values({
    username: `card166-${suffix}-${role}-${cleanup.length}`, passwordHash: 'x', role,
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  return u;
}

async function mkTruck(label: string) {
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `C166-${plateSeed}-${label}`, status: 'ACTIVE',
  }).returning();
  track(async () => {
    await db.delete(s.truckAccountantAssignments).where(eq(s.truckAccountantAssignments.truckId, truck.id));
    await db.delete(s.trucks).where(eq(s.trucks.id, truck.id));
  });
  return truck;
}

async function activeRows(truckId: number) {
  return db.select().from(s.truckAccountantAssignments)
    .where(and(eq(s.truckAccountantAssignments.truckId, truckId), isNull(s.truckAccountantAssignments.endedAt)));
}

async function allRows(truckId: number) {
  return db.select().from(s.truckAccountantAssignments)
    .where(eq(s.truckAccountantAssignments.truckId, truckId));
}

/** Runs the batch in its own committed transaction. */
async function runBatch(actor: { userId: number; role: 'ACCOUNTANT' | 'ADMIN' }, input: { accountantId: number | null; truckIds: number[] }) {
  return db.transaction(async tx => assignTruckAccountantsBatch(tx, actor, input));
}

after(async () => {
  try {
    for (const fn of cleanup) await fn();
  } catch (error) {
    console.warn('[card166] cleanup:', (error as Error).message);
  }
});

describe('card 20260928_166 - bulk truck assignment (AC1)', () => {
  test('one call assigns many trucks; each keeps exactly one ACTIVE row and the board lists them', async () => {
    const admin = await mkActor('ADMIN');
    const acct = await mkActor('ACCOUNTANT');
    const trucks = [await mkTruck('B1'), await mkTruck('B2'), await mkTruck('B3')];

    const results = await runBatch({ userId: admin.id, role: 'ADMIN' }, { accountantId: acct.id, truckIds: trucks.map(t => t.id) });

    assert.equal(results.length, 3);
    for (const result of results) {
      assert.equal(result.changed, true);
      assert.equal(result.accountantId, acct.id);
      const open = await activeRows(result.truckId);
      assert.equal(open.length, 1, `truck ${result.truckId} carries exactly one ACTIVE assignment`);
      assert.equal(open[0].accountantId, acct.id);
    }

    const board = await listPhoiPhieuTruckAssignments();
    for (const truck of trucks) {
      assert.ok(board.assignments.some(row => row.truckId === truck.id && row.accountantId === acct.id),
        'the assignment board shows the truck as assigned to that accountant');
      assert.equal(board.unassignedTrucks.some(row => row.truckId === truck.id), false,
        'and no longer lists it as unassigned');
    }
  });

  test('re-sending the same batch is a no-op: no new rows, no version burn', async () => {
    const admin = await mkActor('ADMIN');
    const acct = await mkActor('ACCOUNTANT');
    const trucks = [await mkTruck('I1'), await mkTruck('I2')];
    const actor = { userId: admin.id, role: 'ADMIN' as const };
    const input = { accountantId: acct.id, truckIds: trucks.map(t => t.id) };

    const first = await runBatch(actor, input);
    const before = await Promise.all(trucks.map(t => allRows(t.id)));
    const second = await runBatch(actor, input);
    const after = await Promise.all(trucks.map(t => allRows(t.id)));

    assert.equal(first.every(r => r.changed), true);
    assert.equal(second.every(r => r.changed), false, 'a correct pair is reported unchanged');
    for (let i = 0; i < trucks.length; i++) {
      assert.equal(after[i].length, before[i].length, 'replaying the batch writes no history');
      assert.equal(second[i].version, first[i].version, 'and burns no version');
    }
  });

  test('a repeated truck id is processed once (no double version burn)', async () => {
    const admin = await mkActor('ADMIN');
    const acct = await mkActor('ACCOUNTANT');
    const truck = await mkTruck('D1');

    const results = await runBatch({ userId: admin.id, role: 'ADMIN' }, { accountantId: acct.id, truckIds: [truck.id, truck.id, truck.id] });

    assert.equal(results.length, 1, 'the duplicate ids collapse to one truck');
    assert.equal((await allRows(truck.id)).length, 1, 'and only one assignment row exists');
  });

  test('all-or-nothing: one bad truck aborts the whole batch and writes nothing', async () => {
    const admin = await mkActor('ADMIN');
    const acct = await mkActor('ACCOUNTANT');
    const good = [await mkTruck('A1'), await mkTruck('A2')];
    const missingTruckId = 2_000_000_000 + (Date.now() % 1000);

    await assert.rejects(
      () => runBatch({ userId: admin.id, role: 'ADMIN' }, { accountantId: acct.id, truckIds: [...good.map(t => t.id), missingTruckId] }),
      /Không tìm thấy xe/,
    );

    for (const truck of good) {
      assert.equal((await allRows(truck.id)).length, 0,
        'the trucks earlier in the batch are NOT left half-assigned');
    }
  });

  test('a re-split keeps the previous assignment as history (AC3 stays intact)', async () => {
    const admin = await mkActor('ADMIN');
    const acctA = await mkActor('ACCOUNTANT');
    const acctB = await mkActor('ACCOUNTANT');
    const truck = await mkTruck('H1');
    const actor = { userId: admin.id, role: 'ADMIN' as const };

    await runBatch(actor, { accountantId: acctA.id, truckIds: [truck.id] });
    const [firstRow] = await activeRows(truck.id);
    await runBatch(actor, { accountantId: acctB.id, truckIds: [truck.id] });

    const open = await activeRows(truck.id);
    assert.equal(open.length, 1, 'still exactly one ACTIVE row after the re-split');
    assert.equal(open[0].accountantId, acctB.id);
    const history = await allRows(truck.id);
    assert.equal(history.length, 2, 'the earlier assignment is kept, not deleted');
    assert.ok(history.some(row => row.id === firstRow.id && row.endedAt != null),
      'and it carries an endedAt');
  });
});
