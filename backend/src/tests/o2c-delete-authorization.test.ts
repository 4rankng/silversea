/**
 * O2C delete-authorization matrix (260801-2200 phase-03).
 *
 * Pure-logic tests of `canDelete` — no DB. Documents the full matrix:
 *   - approvedAt != null → only ADMIN/MANAGER may delete (in any session)
 *   - ADMIN/MANAGER → always allowed
 *   - createdBy mismatch → forbidden
 *   - in-session (within idle window) → allowed
 *   - out-of-session → routes to delete-request queue
 *
 * Keys off `approvedAt` (the real approval action), NOT `approvalStatus` (which
 * defaults to 'APPROVED' on legacy rows and would make everything undeletable).
 */
import { after, test, describe } from 'node:test';
import assert from 'node:assert';
import { and, eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import {
  canDelete,
  createDeleteRequest,
  DEFAULT_IDLE_WINDOW_MS,
  type DeletableRow,
  type DeleteActor,
  type DeleteOutcome,
} from '../services/delete-authorization.service';

/** Type-narrow the union to the denied branch for assertion (tsc can't follow assert). */
function deniedReason(o: DeleteOutcome): string {
  if (!o.allowed) return o.reason;
  throw new Error('expected denied outcome but got allowed');
}

const NOW = new Date('2026-08-01T12:00:00Z');
const IN_SESSION_AGO = new Date(NOW.getTime() - 30 * 60 * 1000); // 30 min ago
const OUT_OF_SESSION_AGO = new Date(NOW.getTime() - DEFAULT_IDLE_WINDOW_MS - 60 * 1000); // 4h+1m ago
const queueEntityType = `delete-auth-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let queueRequesterId = 0;

function row(overrides: Partial<DeletableRow> = {}): DeletableRow {
  return {
    id: 1,
    createdAt: IN_SESSION_AGO,
    createdBy: 100,
    approvedAt: null,
    ...overrides,
  };
}

function actor(userId: number, role: string): DeleteActor {
  return { userId, role };
}

describe('canDelete — O2C delete-authorization matrix', () => {
  test('ADMIN/MANAGER can always delete (owner override)', () => {
    const r = row({ createdBy: 999, approvedAt: new Date(), createdAt: OUT_OF_SESSION_AGO });
    assert.equal(canDelete(r, actor(1, Role.ADMIN), NOW).allowed, true);
    assert.equal(canDelete(r, actor(2, Role.MANAGER), NOW).allowed, true);
  });

  test('approvedAt != null blocks non-manager deletion in any session', () => {
    const r = row({ approvedAt: new Date(), createdBy: 100, createdAt: IN_SESSION_AGO });
    const outcome = canDelete(r, actor(100, Role.CLERK), NOW);
    assert.equal(outcome.allowed, false);
    assert.equal(deniedReason(outcome), 'approved');
  });

  test('creator can delete own in-session, un-approved row', () => {
    const r = row({ createdBy: 100, approvedAt: null, createdAt: IN_SESSION_AGO });
    assert.equal(canDelete(r, actor(100, Role.CLERK), NOW).allowed, true);
  });

  test('creator cannot delete own out-of-session row (routes to queue)', () => {
    const r = row({ createdBy: 100, approvedAt: null, createdAt: OUT_OF_SESSION_AGO });
    const outcome = canDelete(r, actor(100, Role.CLERK), NOW);
    assert.equal(outcome.allowed, false);
    assert.equal(deniedReason(outcome), 'out_of_session');
  });

  test('cannot delete a row created by someone else', () => {
    const r = row({ createdBy: 200, approvedAt: null, createdAt: IN_SESSION_AGO });
    const outcome = canDelete(r, actor(100, Role.CLERK), NOW);
    assert.equal(outcome.allowed, false);
    assert.equal(deniedReason(outcome), 'not_owner');
  });

  test('legacy row with approvalStatus=APPROVED but approvedAt=null remains deletable (the bug avoided)', () => {
    // The original draft's blanket backfill of accountant_approved_at = now()
    // on every APPROVED-status row would have made this undeletable. Keying off
    // approvedAt (null here) keeps it deletable for the in-session creator.
    const r = row({ createdBy: 100, approvedAt: null, createdAt: IN_SESSION_AGO });
    assert.equal(canDelete(r, actor(100, Role.DRIVER), NOW).allowed, true);
  });

  test('DRIVER role is not an owner override', () => {
    const r = row({ createdBy: 999, approvedAt: null, createdAt: OUT_OF_SESSION_AGO });
    const outcome = canDelete(r, actor(50, Role.DRIVER), NOW);
    assert.equal(outcome.allowed, false);
    assert.equal(deniedReason(outcome), 'not_owner');
  });
});

describe('delete-request queue', () => {
  test('deduplicates repeated pending requests from the same requester for the same entity', async () => {
    if (queueRequesterId === 0) {
      const [user] = await db.insert(s.users).values({
        username: `delete-auth-requester-${Date.now()}`,
        passwordHash: 'x',
        role: Role.MANAGER,
        status: 'ACTIVE',
      }).returning({ id: s.users.id });
      queueRequesterId = user.id;
    }
    await createDeleteRequest({
      entityType: queueEntityType,
      entityId: 501,
      requestedBy: queueRequesterId,
      reason: 'first request',
    });
    await createDeleteRequest({
      entityType: queueEntityType,
      entityId: 501,
      requestedBy: queueRequesterId,
      reason: 'duplicate request',
    });

    const rows = await db.select({
      id: s.deleteRequests.id,
      reason: s.deleteRequests.reason,
    }).from(s.deleteRequests)
      .where(and(
        eq(s.deleteRequests.entityType, queueEntityType),
        eq(s.deleteRequests.entityId, 501),
        eq(s.deleteRequests.requestedBy, queueRequesterId),
      ));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.reason, 'first request');
  });
});

after(async () => {
  await db.delete(s.deleteRequests).where(eq(s.deleteRequests.entityType, queueEntityType));
  if (queueRequesterId !== 0) {
    await db.delete(s.users).where(eq(s.users.id, queueRequesterId));
  }
  await client.end();
});
