import assert from 'node:assert';
import { describe, test } from 'node:test';
import {
  SOURCE_AUTHORITY_CATALOG,
  SOURCE_AUTHORITY_PAIR_IDS,
  SOURCE_AUTHORITY_POLICIES,
  findSourceAuthorityPolicy,
  getSourceAuthorityActions,
  isSourceAuthorityActionAllowed,
} from './source-authority.ts';

describe('Q22 source-authority catalog', () => {
  test('exhaustively contains every accepted source/dependent pair', () => {
    assert.deepStrictEqual(
      SOURCE_AUTHORITY_POLICIES.map((policy) => policy.id),
      SOURCE_AUTHORITY_PAIR_IDS,
    );
    assert.strictEqual(
      new Set(
        SOURCE_AUTHORITY_POLICIES.map(
          (policy) => `${policy.source}:${policy.dependent}`,
        ),
      ).size,
      SOURCE_AUTHORITY_PAIR_IDS.length,
      'each accepted source/dependent pair must be unique',
    );

    for (const id of SOURCE_AUTHORITY_PAIR_IDS) {
      assert.strictEqual(SOURCE_AUTHORITY_CATALOG[id].id, id);
      assert.strictEqual(
        SOURCE_AUTHORITY_CATALOG[id].warnStakeholdersOnChange,
        true,
        `${id} must explicitly warn stakeholders when its source changes`,
      );
    }
  });

  test('maps shipment facts to trip recompute before dispatch and version after dispatch', () => {
    const policy = SOURCE_AUTHORITY_CATALOG.SHIPMENT_TO_TRIP;

    assert.deepStrictEqual(policy.authoritativeFields, [
      'SHIPMENT_CUSTOMER',
      'SHIPMENT_CARGO',
      'SHIPMENT_CONTAINERS',
    ]);
    assert.deepStrictEqual(policy.preMilestoneActions, ['RECOMPUTE']);
    assert.deepStrictEqual(policy.postMilestoneActions, ['VERSION']);
  });

  test('maps trip changes to draft and AR recompute, then adjustment after issue', () => {
    for (const id of [
      'TRIP_TO_DRAFT_DEBIT_NOTE',
      'TRIP_TO_ACCOUNTS_RECEIVABLE',
    ] as const) {
      const policy = SOURCE_AUTHORITY_CATALOG[id];
      assert.deepStrictEqual(policy.preMilestoneActions, ['RECOMPUTE']);
      assert.deepStrictEqual(policy.postMilestoneActions, ['ADJUST']);
      assert.strictEqual(policy.immutableAfterMilestone, true);
    }
  });

  test('makes only approved expense status and amount authoritative', () => {
    for (const id of [
      'EXPENSE_TO_COST_REPORTING',
      'EXPENSE_TO_DRAFT_DEBIT_NOTE',
    ] as const) {
      const policy = SOURCE_AUTHORITY_CATALOG[id];
      assert.strictEqual(policy.expenseAuthority, 'APPROVED_ONLY');
      assert.deepStrictEqual(policy.authoritativeFields, [
        'EXPENSE_APPROVAL_STATUS',
        'EXPENSE_AMOUNT',
      ]);
      assert.deepStrictEqual(policy.preMilestoneActions, ['RECOMPUTE']);
      assert.deepStrictEqual(policy.postMilestoneActions, ['ADJUST']);
    }
  });

  test('keeps issued receivables and recorded payments immutable through adjustments or reversals', () => {
    for (const id of [
      'ISSUED_DEBIT_NOTE_TO_ACCOUNTS_RECEIVABLE',
      'RECEIPT_ALLOCATION_TO_PAID_OUTSTANDING',
    ] as const) {
      const policy = SOURCE_AUTHORITY_CATALOG[id];
      assert.deepStrictEqual(policy.preMilestoneActions, []);
      assert.deepStrictEqual(policy.postMilestoneActions, [
        'ADJUST',
        'REVERSE',
      ]);
      assert.strictEqual(policy.immutableAfterMilestone, true);
    }
  });

  test('fails closed for an undefined pair or action', () => {
    assert.strictEqual(
      findSourceAuthorityPolicy('SHIPMENT', 'ACCOUNTS_RECEIVABLE'),
      null,
    );
    assert.deepStrictEqual(
      getSourceAuthorityActions(
        'SHIPMENT',
        'ACCOUNTS_RECEIVABLE',
        'PRE_MILESTONE',
      ),
      [],
    );
    assert.strictEqual(
      isSourceAuthorityActionAllowed(
        'TRIP',
        'DRAFT_DEBIT_NOTE',
        'PRE_MILESTONE',
        'RECOMPUTE',
      ),
      true,
    );
    assert.strictEqual(
      isSourceAuthorityActionAllowed(
        'TRIP',
        'DRAFT_DEBIT_NOTE',
        'PRE_MILESTONE',
        'DELETE',
      ),
      false,
    );
    assert.strictEqual(
      isSourceAuthorityActionAllowed(
        'TRIP',
        'PAID_OUTSTANDING',
        'POST_MILESTONE',
        'ADJUST',
      ),
      false,
    );
    assert.deepStrictEqual(
      getSourceAuthorityActions('TRIP', 'DRAFT_DEBIT_NOTE', 'TYPO'),
      [],
    );
    assert.strictEqual(
      isSourceAuthorityActionAllowed(
        'TRIP',
        'DRAFT_DEBIT_NOTE',
        'TYPO',
        'ADJUST',
      ),
      false,
    );
  });
});
