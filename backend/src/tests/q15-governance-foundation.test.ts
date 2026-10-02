import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import {
  GOVERNANCE_ACTION_KINDS,
  directFinancialActionSchema,
  Role,
} from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import {
  assertCanApplyGovernanceAction,
  assertCanMakeGovernanceAction,
  getGovernancePolicy,
} from '../services/governance-policy';
import {
  applyGovernanceActionDirect,
  buildGovernanceAction,
} from '../services/governance-action-core.service';

const actorIds: number[] = [];
const ledgerIds: number[] = [];
let actors: Array<{ id: number; role: string }> = [];

before(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  actors = await db.insert(s.users).values([
    { username: `q15-maker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT },
    { username: `q15-checker-${suffix}`, passwordHash: 'x', role: Role.MANAGER },
    { username: `q15-approver-${suffix}`, passwordHash: 'x', role: Role.ADMIN },
    { username: `q15-viewer-${suffix}`, passwordHash: 'x', role: Role.DRIVER },
  ]).returning({ id: s.users.id, role: s.users.role });
  actorIds.push(...actors.map(actor => actor.id));
});

after(async () => {
  if (ledgerIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
  }
  if (actorIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, actorIds));
  }
  await client.end();
});

/**
 * Builds the transient governed action the make stage returns (same fields the
 * dropped governance_actions insert carried).
 */
function buildTransientAction(values: {
  subjectId?: number;
  deltaSnapshot: Record<string, unknown>;
  makerIndex?: number;
}) {
  const maker = actors[values.makerIndex ?? 0]!;
  return buildGovernanceAction({
    subjectType: 'TRIP',
    subjectId: values.subjectId ?? 1_700_000_000,
    actionKind: 'TRIP_AR_ADJUSTMENT',
    reason: 'Q15 governance foundation test',
    originalVersion: 1,
    beforeSnapshot: { amount: 100 },
    afterSnapshot: { amount: 125 },
    deltaSnapshot: values.deltaSnapshot,
    makerId: maker.id,
    makerRole: Role.ACCOUNTANT,
  });
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
  it('validates the shared decision contract', () => {
    assert.equal(directFinancialActionSchema.safeParse({
      expectedVersion: 1,
      reason: '   ',
    }).success, false);
  });

  it('has a policy for live action kinds and rejects retired approval commands', () => {
    const retiredApprovalKinds = new Set(['TRIP_EXPENSE_APPROVAL', 'CREDIT_OVERRIDE_APPROVAL', 'DEBT_OFFSET_APPROVAL',
      'SHIPMENT_REOPEN_REQUEST', 'SHIPMENT_DELETE_REQUEST', 'CONTAINER_EDIT_REQUEST',
      'FUEL_INVOICE_APPROVAL', 'ADVANCE_REQUEST_APPROVAL', 'ADVANCE_REQUEST_REJECTION']);
    for (const actionKind of GOVERNANCE_ACTION_KINDS) {
      if (retiredApprovalKinds.has(actionKind)) {
        assert.throws(() => getGovernancePolicy(actionKind), (error: unknown) => error instanceof ApiError && error.statusCode === 409);
        continue;
      }
      const policy = getGovernancePolicy(actionKind);
      assert.equal(policy.actionKind, actionKind);
    }
  });

  it('authorizes payroll period close and reopen directly for management', () => {
    for (const kind of ['SALARY_PERIOD_CLOSE', 'SALARY_PERIOD_REOPEN']) {
      for (const role of [Role.MANAGER, Role.ADMIN]) {
        assert.doesNotThrow(() => assertCanApplyGovernanceAction(kind, role));
      }
      assert.throws(
        () => assertCanApplyGovernanceAction(kind, Role.ACCOUNTANT),
        (error: unknown) => error instanceof ApiError && error.statusCode === 403,
      );
    }
  });

  it('preserves command creation and direct financial close permission boundaries', () => {
    for (const role of [Role.ACCOUNTANT, Role.CUS, Role.MANAGER, Role.ADMIN]) {
      assert.doesNotThrow(() => assertCanMakeGovernanceAction('TRIP_FINANCIAL_CLOSE', role));
    }
    for (const role of [Role.DRIVER, Role.OPS, Role.DISPATCHER]) {
      assert.throws(
        () => assertCanMakeGovernanceAction('TRIP_FINANCIAL_CLOSE', role),
        (error: unknown) => error instanceof ApiError && error.statusCode === 403,
      );
    }
    for (const role of [Role.MANAGER, Role.ADMIN]) {
      assert.doesNotThrow(() => assertCanApplyGovernanceAction('TRIP_FINANCIAL_CLOSE', role));
    }
    for (const role of [Role.ACCOUNTANT, Role.CUS]) {
      assert.throws(
        () => assertCanApplyGovernanceAction('TRIP_FINANCIAL_CLOSE', role),
        (error: unknown) => error instanceof ApiError && error.statusCode === 403,
      );
    }
  });

  it('NO-APP-15: direct apply records the command without checker or pending approval stages', async () => {
    const action = buildTransientAction({
      deltaSnapshot: { amount: 25, signedAgreementRef: 'Q15-TEST-EVIDENCE' },
    });
    assert.equal(action.status, 'READY');
    const applied = await applyGovernanceActionDirect({
      action,
      actorId: actors[1]!.id,
      actorRole: Role.MANAGER,
      apply: async (_tx, command) => {
        assert.equal(command.status, 'READY');
        assert.equal(command.checkerId, null);
        assert.equal(command.checkedAt, null);
        return { applicationResult: { resultingVersion: 2 } };
      },
    });
    assert.equal(applied.action.status, 'APPROVED');
    assert.equal(applied.action.makerRole, Role.ACCOUNTANT);
    assert.equal(applied.action.checkerId, null);
    assert.equal(applied.action.checkerRole, null);
    assert.equal(applied.action.approverId, actors[1]!.id);
    assert.equal(applied.action.approverRole, Role.MANAGER);
    assert.ok(applied.action.appliedAt instanceof Date);
    assert.deepEqual(applied.result, { applicationResult: { resultingVersion: 2 } });
  });

  it('rejects a direct apply from a role without business permission', async () => {
    const action = buildTransientAction({
      deltaSnapshot: { amount: 25, signedAgreementRef: 'Q15-TEST-EVIDENCE' },
    });
    await expectApiError(
      applyGovernanceActionDirect({
        action,
        actorId: actors[3]!.id,
        actorRole: Role.DRIVER,
        apply: async () => undefined,
      }),
      403,
      /không có quyền/,
    );
  });

  it('rejects a direct apply that is missing required evidence', async () => {
    const action = buildTransientAction({
      deltaSnapshot: { amount: 25 },
    });
    await expectApiError(
      applyGovernanceActionDirect({
        action,
        actorId: actors[1]!.id,
        actorRole: Role.MANAGER,
        apply: async () => undefined,
      }),
      422,
      /signedAgreementRef/,
    );
  });

  it('rolls back an adapter effect entirely when the apply adapter fails', async () => {
    const action = buildTransientAction({
      deltaSnapshot: { amount: 25, signedAgreementRef: 'Q15-ROLLBACK-EVIDENCE' },
    });
    const marker = `Q15-ROLLBACK-${Date.now()}`;

    await assert.rejects(
      applyGovernanceActionDirect({
        action,
        actorId: actors[1]!.id,
        actorRole: Role.MANAGER,
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
      }),
      /simulated adapter failure/,
    );

    assert.equal(
      (await db.select().from(s.ledger).where(eq(s.ledger.note, marker))).length,
      0,
      'adapter effects must roll back with the failed transaction',
    );

    const approved = await applyGovernanceActionDirect({
      action,
      actorId: actors[1]!.id,
      actorRole: Role.MANAGER,
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
    assert.equal(approved.action.status, 'APPROVED');
    assert.equal(approved.action.ledgerEntryId, ledgerIds.at(-1));
  });
});
