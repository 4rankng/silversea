import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import {
  GOVERNANCE_ACTION_KINDS,
  governanceActionDecisionSchema,
  governanceActionListQuerySchema,
  governanceActionVersionSchema,
  Role,
} from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { globalErrorHandler } from '../middleware/errorHandler';
import paymentsRoutes from '../routes/financial/payments.routes';
import {
  assertCanApproveGovernanceAction,
  assertCanCheckGovernanceAction,
  assertCanMakeGovernanceAction,
  getGovernancePolicy,
  getGovernanceAllowedActions,
} from '../services/governance-policy';
import {
  approveGovernanceActionWithAdapter,
  cancelGovernanceAction,
  checkGovernanceAction,
  getGovernanceAction,
  listGovernanceActions,
  rejectGovernanceAction,
  returnGovernanceActionForEvidence,
} from '../services/governance-transition.service';

const actorIds: number[] = [];
const actionIds: number[] = [];
const ledgerIds: number[] = [];
let actors: Array<{ id: number; role: string }> = [];
let nextSubjectId = 1_700_000_000 + Math.floor(Math.random() * 10_000_000);
let server: http.Server;
let baseUrl = '';

before(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  actors = await db.insert(s.users).values([
    { username: `q15-maker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT },
    { username: `q15-checker-${suffix}`, passwordHash: 'x', role: Role.MANAGER },
    { username: `q15-approver-${suffix}`, passwordHash: 'x', role: Role.ADMIN },
    { username: `q15-other-${suffix}`, passwordHash: 'x', role: Role.MANAGER },
    { username: `q15-viewer-${suffix}`, passwordHash: 'x', role: Role.DRIVER },
  ]).returning({ id: s.users.id, role: s.users.role });
  actorIds.push(...actors.map(actor => actor.id));

  const app = express();
  app.use(express.json());
  app.use('/api', (req, _res, next) => {
    const actorIndex = Number(req.header('X-Test-Actor') ?? 1);
    const actor = actors[actorIndex] ?? actors[1]!;
    req.user = {
      userId: actor.id,
      username: `q15-actor-${actor.id}`,
      email: null,
      fullName: null,
      role: actor.role as Role,
    };
    next();
  });
  app.use('/api', paymentsRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (actionIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, actionIds));
  }
  if (ledgerIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
  }
  if (actorIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, actorIds));
  }
  await client.end();
});

async function createAction() {
  const [action] = await db.insert(s.governanceActions).values({
    subjectType: 'TRIP',
    subjectId: nextSubjectId++,
    actionKind: 'TRIP_AR_ADJUSTMENT',
    reason: 'Q15 governance foundation test',
    originalVersion: 1,
    beforeSnapshot: { amount: 100 },
    afterSnapshot: { amount: 125 },
    deltaSnapshot: { amount: 25, signedAgreementRef: 'Q15-TEST-EVIDENCE' },
    makerId: actors[0]!.id,
    makerRole: Role.ACCOUNTANT,
  }).returning();
  actionIds.push(action.id);
  return action;
}

async function expectApiError(
  operation: Promise<unknown>,
  statusCode: number,
  pattern: RegExp,
) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.statusCode, statusCode);
    assert.match(error.message, pattern);
    return true;
  });
}

describe('Q15 shared governance foundation', () => {
  it('validates shared transition and bounded list contracts', () => {
    assert.deepEqual(governanceActionVersionSchema.parse({ expectedVersion: '2' }), {
      expectedVersion: 2,
    });
    assert.equal(governanceActionVersionSchema.safeParse({ expectedVersion: 0 }).success, false);
    assert.equal(governanceActionDecisionSchema.safeParse({
      expectedVersion: 1,
      reason: '   ',
    }).success, false);
    assert.deepEqual(governanceActionListQuerySchema.parse({
      status: 'PENDING_CHECK',
      subjectKey: '  7:2026-07  ',
      limit: '25',
    }), {
      status: 'PENDING_CHECK',
      subjectKey: '7:2026-07',
      page: 1,
      limit: 25,
      offset: 0,
    });
    assert.equal(governanceActionListQuerySchema.safeParse({
      subjectKey: ' '.repeat(3),
    }).success, false);
  });

  it('keeps the shared action-kind enum and common policy catalog in sync', () => {
    assert.equal(
      governanceActionListQuerySchema.parse({ actionKind: 'SALARY_PERIOD_ADJUSTMENT' }).actionKind,
      'SALARY_PERIOD_ADJUSTMENT',
    );
    for (const actionKind of GOVERNANCE_ACTION_KINDS) {
      const policy = getGovernancePolicy(actionKind);
      assert.equal(policy.actionKind, actionKind);
    }
  });

  it('enforces the accepted Q11 salary-period role mapping', async () => {
    // 2026-09-10 (phê duyệt removed): SALARY_PERIOD_CLOSE stages gate on
    // capability only — the maker role list is gone so a single actor
    // (MANAGER/ADMIN holding PERIOD_CLOSE_APPROVE) can run the whole chain.
    // ACCOUNTANT can still make the request but cannot approve it.
    assert.doesNotThrow(() => assertCanMakeGovernanceAction(
      'SALARY_PERIOD_CLOSE',
      Role.ACCOUNTANT,
    ));
    assert.doesNotThrow(() => assertCanMakeGovernanceAction(
      'SALARY_PERIOD_CLOSE',
      Role.MANAGER,
    ));

    const closeAction = {
      actionKind: 'SALARY_PERIOD_CLOSE',
      status: 'PENDING_CHECK',
      makerId: actors[0]!.id,
      checkerId: actors[1]!.id,
    };
    assert.doesNotThrow(() => assertCanCheckGovernanceAction(closeAction, {
      actorId: actors[1]!.id,
      actorRole: Role.MANAGER,
    }));
    assert.doesNotThrow(() => assertCanApproveGovernanceAction(closeAction, {
      actorId: actors[2]!.id,
      actorRole: Role.ADMIN,
    }));
    assert.throws(
      () => assertCanApproveGovernanceAction(closeAction, {
        actorId: actors[3]!.id,
        actorRole: Role.ACCOUNTANT,
      }),
      (error: unknown) => error instanceof ApiError && error.statusCode === 403,
    );

    assert.doesNotThrow(() => assertCanMakeGovernanceAction(
      'SALARY_PERIOD_REOPEN',
      Role.MANAGER,
    ));
    assert.doesNotThrow(() => assertCanMakeGovernanceAction(
      'SALARY_PERIOD_REOPEN',
      Role.ADMIN,
    ));
    assert.throws(
      () => assertCanMakeGovernanceAction('SALARY_PERIOD_REOPEN', Role.ACCOUNTANT),
      (error: unknown) => error instanceof ApiError && error.statusCode === 403,
    );
  });

  it('assigns O2C close creation to Accounting/CUS with an independent finance checker and manager approver', () => {
    assert.doesNotThrow(() => assertCanMakeGovernanceAction('TRIP_FINANCIAL_CLOSE', Role.ACCOUNTANT));
    assert.doesNotThrow(() => assertCanMakeGovernanceAction('TRIP_FINANCIAL_CLOSE', Role.CUS));
    for (const role of [Role.ADMIN, Role.MANAGER, Role.DRIVER, Role.OPS, Role.DISPATCHER]) {
      assert.throws(
        () => assertCanMakeGovernanceAction('TRIP_FINANCIAL_CLOSE', role),
        (error: unknown) => error instanceof ApiError && error.statusCode === 403,
      );
    }
    const action = {
      actionKind: 'TRIP_FINANCIAL_CLOSE',
      status: 'PENDING_CHECK',
      makerId: actors[0]!.id,
      checkerId: actors[1]!.id,
    };
    assert.doesNotThrow(() => assertCanCheckGovernanceAction(action, {
      actorId: actors[1]!.id,
      actorRole: Role.ACCOUNTANT,
    }));
    assert.doesNotThrow(() => assertCanApproveGovernanceAction(action, {
      actorId: actors[2]!.id,
      actorRole: Role.MANAGER,
    }));
  });

  it('enforces pairwise actors, capabilities, role snapshots and allowed actions', async () => {
    const action = await createAction();
    assert.deepEqual(getGovernanceAllowedActions(action, {
      actorId: actors[0]!.id,
      actorRole: Role.ACCOUNTANT,
    }), ['CANCEL']);
    assert.deepEqual(getGovernanceAllowedActions(action, {
      actorId: actors[1]!.id,
      actorRole: Role.MANAGER,
    }), ['CHECK', 'REJECT', 'RETURN_FOR_EVIDENCE']);
    assert.deepEqual(getGovernanceAllowedActions(action, {
      actorId: actors[4]!.id,
      actorRole: Role.DRIVER,
    }), []);

    await expectApiError(checkGovernanceAction({
      actionId: action.id,
      checkerId: actors[4]!.id,
      checkerRole: Role.DRIVER,
      expectedVersion: action.version,
    }), 403, /không có quyền/);

    // 2026-09-10 (phê duyệt removed): the maker may check and approve their
    // own request — maker/checker/approver segregation is gone; capability
    // checks remain.
    const checked = await checkGovernanceAction({
      actionId: action.id,
      checkerId: actors[0]!.id,
      checkerRole: Role.ACCOUNTANT,
      expectedVersion: action.version,
    });
    assert.equal(checked.checkerRole, Role.ACCOUNTANT);
    await expectApiError(approveGovernanceActionWithAdapter({
      actionId: action.id,
      approverId: actors[4]!.id,
      approverRole: Role.DRIVER,
      expectedVersion: checked.version,
      apply: async () => undefined,
    }), 403, /không có quyền/);

    const approved = await approveGovernanceActionWithAdapter({
      actionId: action.id,
      approverId: actors[2]!.id,
      approverRole: Role.ADMIN,
      expectedVersion: checked.version,
      apply: async () => ({
        applicationResult: { resultingVersion: 2 },
      }),
    });
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.makerRole, Role.ACCOUNTANT);
    assert.equal(approved.checkerRole, Role.ACCOUNTANT);
    assert.equal(approved.approverRole, Role.ADMIN);
    assert.deepEqual(approved.applicationResult, { resultingVersion: 2 });
  });

  it('persists reasoned reject, return and maker-only cancellation decisions', async () => {
    const rejectedAction = await createAction();
    const rejected = await rejectGovernanceAction({
      actionId: rejectedAction.id,
      actorId: actors[1]!.id,
      actorRole: Role.MANAGER,
      expectedVersion: rejectedAction.version,
      reason: 'Chứng từ không hợp lệ',
    });
    assert.equal(rejected.status, 'REJECTED');
    assert.equal(rejected.rejectedBy, actors[1]!.id);
    assert.equal(rejected.rejectedRole, Role.MANAGER);
    assert.equal(rejected.rejectionReason, 'Chứng từ không hợp lệ');

    const returnedAction = await createAction();
    const returned = await returnGovernanceActionForEvidence({
      actionId: returnedAction.id,
      actorId: actors[1]!.id,
      actorRole: Role.MANAGER,
      expectedVersion: returnedAction.version,
      reason: 'Bổ sung biên bản',
    });
    assert.equal(returned.status, 'RETURNED_FOR_EVIDENCE');
    assert.equal(returned.returnedBy, actors[1]!.id);
    assert.equal(returned.returnReason, 'Bổ sung biên bản');
    await expectApiError(cancelGovernanceAction({
      actionId: returned.id,
      actorId: actors[3]!.id,
      actorRole: Role.MANAGER,
      expectedVersion: returned.version,
      reason: 'Không phải người tạo',
    }), 403, /Chỉ người tạo/);
    const canceled = await cancelGovernanceAction({
      actionId: returned.id,
      actorId: actors[0]!.id,
      actorRole: Role.ACCOUNTANT,
      expectedVersion: returned.version,
      reason: 'Không tiếp tục yêu cầu',
    });
    assert.equal(canceled.status, 'CANCELED');
    assert.equal(canceled.canceledBy, actors[0]!.id);
    assert.equal(canceled.cancelReason, 'Không tiếp tục yêu cầu');
  });

  it('durably returns missing required evidence instead of advancing to approval', async () => {
    const action = await createAction();
    await db.update(s.governanceActions).set({
      deltaSnapshot: { amount: 25 },
    }).where(eq(s.governanceActions.id, action.id));
    const returned = await checkGovernanceAction({
      actionId: action.id,
      checkerId: actors[1]!.id,
      checkerRole: Role.MANAGER,
      expectedVersion: action.version,
    });
    assert.equal(returned.status, 'RETURNED_FOR_EVIDENCE');
    assert.equal(returned.returnedBy, actors[1]!.id);
    assert.equal(returned.returnedRole, Role.MANAGER);
    assert.match(returned.returnReason ?? '', /signedAgreementRef/);
    assert.equal(returned.checkerId, null);
  });

  it('allows exactly one concurrent decision from the same source version', async () => {
    const action = await createAction();
    const outcomes = await Promise.allSettled([
      checkGovernanceAction({
        actionId: action.id,
        checkerId: actors[1]!.id,
        checkerRole: Role.MANAGER,
        expectedVersion: action.version,
      }),
      rejectGovernanceAction({
        actionId: action.id,
        actorId: actors[3]!.id,
        actorRole: Role.MANAGER,
        expectedVersion: action.version,
        reason: 'Từ chối đồng thời',
      }),
    ]);
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length, 1);
    const [saved] = await db.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, action.id));
    assert.ok(['PENDING_APPROVAL', 'REJECTED'].includes(saved.status));
    assert.equal(saved.version, action.version + 1);
  });

  it('rolls back both an adapter effect and final approval when application fails', async () => {
    const action = await createAction();
    const checked = await checkGovernanceAction({
      actionId: action.id,
      checkerId: actors[1]!.id,
      checkerRole: Role.MANAGER,
      expectedVersion: action.version,
    });
    const marker = `Q15-ROLLBACK-${action.id}`;

    await assert.rejects(approveGovernanceActionWithAdapter({
      actionId: action.id,
      approverId: actors[2]!.id,
      approverRole: Role.ADMIN,
      expectedVersion: checked.version,
      apply: async (tx) => {
        await tx.insert(s.ledger).values({
          txnType: 'ADJUSTMENT',
          txnId: action.subjectId!,
          entityType: 'CUSTOMER',
          entityId: 1_700_000_000,
          debit: '25',
          credit: '0',
          balance: '25',
          note: marker,
        });
        throw new Error('simulated adapter failure');
      },
    }), /simulated adapter failure/);

    const [stillPending] = await db.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, action.id));
    assert.equal(stillPending.status, 'PENDING_APPROVAL');
    assert.equal(stillPending.approverId, null);
    assert.equal((await db.select().from(s.ledger).where(eq(s.ledger.note, marker))).length, 0);

    const approved = await approveGovernanceActionWithAdapter({
      actionId: action.id,
      approverId: actors[2]!.id,
      approverRole: Role.ADMIN,
      expectedVersion: checked.version,
      apply: async (tx) => {
        const [entry] = await tx.insert(s.ledger).values({
          txnType: 'ADJUSTMENT',
          txnId: action.subjectId!,
          entityType: 'CUSTOMER',
          entityId: 1_700_000_000,
          debit: '25',
          credit: '0',
          balance: '25',
          note: marker,
        }).returning({ id: s.ledger.id });
        ledgerIds.push(entry.id);
        return { ledgerEntryId: entry.id };
      },
    });
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.ledgerEntryId, ledgerIds.at(-1));
  });

  it('returns scoped views with server-computed actions and denies non-financial viewers', async () => {
    const action = await createAction();
    const detail = await getGovernanceAction({
      actionId: action.id,
      actorId: actors[1]!.id,
      actorRole: Role.MANAGER,
    });
    assert.deepEqual(detail.allowedActions, ['CHECK', 'REJECT', 'RETURN_FOR_EVIDENCE']);
    const listed = await listGovernanceActions({
      actorId: actors[0]!.id,
      actorRole: Role.ACCOUNTANT,
      query: {
        subjectId: action.subjectId!,
        page: 1,
        limit: 10,
        offset: 0,
      },
    });
    assert.equal(listed.items.length, 1);
    assert.deepEqual(listed.items[0]!.allowedActions, ['CANCEL']);
    await expectApiError(getGovernanceAction({
      actionId: action.id,
      actorId: actors[4]!.id,
      actorRole: Role.DRIVER,
    }), 403, /không có quyền xem/);
    await expectApiError(listGovernanceActions({
      actorId: actors[4]!.id,
      actorRole: Role.DRIVER,
      query: { page: 1, limit: 10, offset: 0 },
    }), 403, /không có quyền xem/);
  });

  it('allows the maker to check their own request (segregation removed 2026-09-10)', async () => {
    const [action] = await db.insert(s.governanceActions).values({
      subjectType: 'TRIP',
      subjectId: nextSubjectId++,
      actionKind: 'TRIP_AR_ADJUSTMENT',
      reason: 'Maker self-check',
      originalVersion: 1,
      beforeSnapshot: {},
      afterSnapshot: {},
      deltaSnapshot: { signedAgreementRef: 'SA-SELF-CHECK' },
      makerId: actors[0]!.id,
      makerRole: Role.ACCOUNTANT,
    }).returning();
    actionIds.push(action.id);

    const checked = await checkGovernanceAction({
      actionId: action.id,
      checkerId: actors[0]!.id,
      checkerRole: Role.ACCOUNTANT,
      expectedVersion: action.version,
    });
    assert.equal(checked.status, 'PENDING_APPROVAL');
    assert.equal(checked.checkerId, actors[0]!.id);
  });

  it('prevents duplicate active proposals for future subject-id action kinds', async () => {
    const subjectId = nextSubjectId++;
    const [first] = await db.insert(s.governanceActions).values({
      subjectType: 'PENALTY',
      subjectId,
      actionKind: 'PENALTY_CREATE',
      reason: 'First active proposal',
      originalVersion: 1,
      beforeSnapshot: {},
      afterSnapshot: {},
      makerId: actors[0]!.id,
      makerRole: Role.ACCOUNTANT,
    }).returning();
    actionIds.push(first.id);
    await assert.rejects(db.insert(s.governanceActions).values({
      subjectType: 'PENALTY',
      subjectId,
      actionKind: 'PENALTY_CREATE',
      reason: 'Duplicate active proposal',
      originalVersion: 1,
      beforeSnapshot: {},
      afterSnapshot: {},
      makerId: actors[1]!.id,
      makerRole: Role.MANAGER,
    }), (error: unknown) => {
      const cause = (error as { cause?: { message?: string } }).cause;
      assert.match(cause?.message ?? '', /governance_actions_active_subject_id_uniq/);
      return true;
    });
  });
});
