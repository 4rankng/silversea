import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role, type GovernanceActionListQuery } from '@tingting/shared';
import { listGovernanceActions } from '../services/governance-transition.service';

// Column sorting for the approval-center queue: whitelisted sortBy keys,
// attention-first status rank, `nulls last` for nullable fields, and an
// unchanged newest-first default when sort params are absent. All seeds share
// one suite-unique subjectId so the subjectId-filtered page holds exactly the
// seeded rows even on a shared local database.
describe('governance actions list sorting', () => {
  const userIds: number[] = [];
  const actionIds: number[] = [];
  const subjectId = 1_700_900_000 + Math.floor(Math.random() * 100_000);
  let viewerId: number;
  // kindA < kindB alphabetically; createdAt runs opposite so kind sorting
  // cannot mask as date sorting (and vice versa).
  const base = Date.now();

  async function seedAction(values: {
    actionKind: string;
    status: string;
    reason: string;
    subjectKey: string | null;
    createdAt: Date;
  }) {
    const [action] = await db.insert(s.governanceActions).values({
      subjectType: 'TRIP',
      subjectId,
      actionKind: values.actionKind,
      status: values.status,
      reason: values.reason,
      subjectKey: values.subjectKey,
      originalVersion: 1,
      beforeSnapshot: { amount: 100 },
      afterSnapshot: { amount: 125 },
      deltaSnapshot: { amount: 25 },
      makerId: viewerId,
      makerRole: Role.ACCOUNTANT,
      createdAt: values.createdAt,
      updatedAt: values.createdAt,
    }).returning({ id: s.governanceActions.id });
    actionIds.push(action.id);
    return action.id;
  }

  before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [viewer] = await db.insert(s.users).values({
      username: `ga-sort-${suffix}`,
      passwordHash: 'x',
      role: Role.ADMIN,
    }).returning({ id: s.users.id });
    viewerId = viewer.id;
    userIds.push(viewer.id);

    await seedAction({ actionKind: 'SALARY_REOPEN', status: 'APPROVED', reason: 'ga-sort z', subjectKey: null, createdAt: new Date(base - 60_000) });
    await seedAction({ actionKind: 'DEBT_OFFSET_APPROVAL', status: 'PENDING_CHECK', reason: 'ga-sort m', subjectKey: 'trip:9', createdAt: new Date(base - 30_000) });
    await seedAction({ actionKind: 'TRIP_REOPEN', status: 'PENDING_APPROVAL', reason: 'ga-sort a', subjectKey: 'trip:7', createdAt: new Date(base) });
  });

  after(async () => {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, actionIds));
    await db.delete(s.users).where(inArray(s.users.id, userIds));
    await client.end();
  });

  function list(sortBy?: GovernanceActionListQuery['sortBy'], sortDir?: 'asc' | 'desc') {
    return listGovernanceActions({
      actorId: viewerId,
      actorRole: Role.ADMIN,
      query: {
        subjectId,
        page: 1,
        limit: 3,
        offset: 0,
        ...(sortBy ? { sortBy, sortDir: sortDir ?? 'asc' } : {}),
      },
    });
  }

  test('absent sort params keep the newest-first id order exactly', async () => {
    const rows = await list();
    assert.deepEqual(rows.items.map(item => item.id), [...actionIds].reverse());
  });

  test('sorts actionKind and reason in both directions', async () => {
    const kindAsc = await list('actionKind', 'asc');
    assert.deepEqual(
      kindAsc.items.map(item => item.actionKind),
      ['DEBT_OFFSET_APPROVAL', 'SALARY_REOPEN', 'TRIP_REOPEN'],
    );
    const kindDesc = await list('actionKind', 'desc');
    assert.deepEqual(
      kindDesc.items.map(item => item.actionKind),
      ['TRIP_REOPEN', 'SALARY_REOPEN', 'DEBT_OFFSET_APPROVAL'],
    );

    const reasonAsc = await list('reason', 'asc');
    assert.deepEqual(
      reasonAsc.items.map(item => item.reason),
      ['ga-sort a', 'ga-sort m', 'ga-sort z'],
    );
  });

  test('status ranks attention-first, not alphabetically', async () => {
    // Alphabetical would be APPROVED, PENDING_APPROVAL, PENDING_CHECK;
    // the rank expression puts the pending stages first.
    const statusAsc = await list('status', 'asc');
    assert.deepEqual(
      statusAsc.items.map(item => item.status),
      ['PENDING_CHECK', 'PENDING_APPROVAL', 'APPROVED'],
    );
  });

  test('subjectKey sorts with nulls last in both directions', async () => {
    const keyAsc = await list('subjectKey', 'asc');
    // 'trip:7' < 'trip:9'; the NULL subjectKey stays last on asc.
    assert.deepEqual(
      keyAsc.items.map(item => item.subjectKey),
      ['trip:7', 'trip:9', null],
    );
    const keyDesc = await list('subjectKey', 'desc');
    // NULLs stay last on desc too (Postgres would otherwise float them first).
    assert.deepEqual(
      keyDesc.items.map(item => item.subjectKey),
      ['trip:9', 'trip:7', null],
    );
  });

  test('createdAt sorts chronologically in both directions', async () => {
    const createdAsc = await list('createdAt', 'asc');
    assert.deepEqual(
      createdAsc.items.map(item => item.reason),
      ['ga-sort z', 'ga-sort m', 'ga-sort a'],
    );
    const createdDesc = await list('createdAt', 'desc');
    assert.deepEqual(
      createdDesc.items.map(item => item.reason),
      ['ga-sort a', 'ga-sort m', 'ga-sort z'],
    );
  });
});
