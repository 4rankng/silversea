import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { OPS_EXPENSE_TYPE_DEFAULTS } from '@tingting/shared';

import {
  INVOICE_REQUIRED_EXPENSE_TYPE_CODES,
  NO_INVOICE_EXPENSE_TYPE_CODES,
  expenseTypeSeedPolicy,
} from '../expense-type-seed-policy';

/**
 * Card 20260928_181: "Mọi danh mục chi phí trong hệ thống đều nhập được — có
 * test duyệt qua TOÀN BỘ danh mục chi phí, không test lẻ từng mục."
 *
 * The distinction matters and the repo had it backwards. expense-fee-catalog
 * asserts 12 codes by LITERAL. The source of truth
 * (OPS_EXPENSE_TYPE_DEFAULTS) carries 22. A thirteenth category would land and
 * that test would stay green — which is the exact shape card 181 is rejecting.
 *
 * So every test here reads the source rather than restating it. That is what
 * turns "these twelve are fine" into "however many exist are classified", which
 * is the only version that stays true as the catalog grows.
 *
 * This found two real holes: CUSTOMS and ZONE_SURCHARGE were in NEITHER set, so
 * expenseTypeSeedPolicy returned requiresInvoice:false together with
 * substituteEvidenceAllowed:false — the approval gate and the evidence gate
 * disagreeing, silently. They are classified in the policy with their reasons.
 */
const SOURCE_CODES = Object.keys(OPS_EXPENSE_TYPE_DEFAULTS);

describe('every cost category is classified (card 20260928_181)', () => {
  test('the source of truth is not empty — a sweep over nothing proves nothing', () => {
    assert.ok(
      SOURCE_CODES.length >= 20,
      `expected the full expense catalog, saw only ${SOURCE_CODES.length}: ${SOURCE_CODES.join(', ')}`,
    );
  });

  test('every category lands in exactly one policy set', () => {
    const unclassified = SOURCE_CODES.filter(
      (code) => !INVOICE_REQUIRED_EXPENSE_TYPE_CODES.has(code) && !NO_INVOICE_EXPENSE_TYPE_CODES.has(code),
    );
    assert.deepEqual(
      unclassified,
      [],
      'these cost categories have no invoice policy, so expenseTypeSeedPolicy returns '
        + 'requiresInvoice:false AND substituteEvidenceAllowed:false for them — a contradictory '
        + `state nothing reports. Classify each one: ${unclassified.join(', ')}`,
    );
  });

  test('no category sits in both sets — an invoice-required entry cannot also waive evidence', () => {
    const both = SOURCE_CODES.filter(
      (code) => INVOICE_REQUIRED_EXPENSE_TYPE_CODES.has(code) && NO_INVOICE_EXPENSE_TYPE_CODES.has(code),
    );
    assert.deepEqual(
      both,
      [],
      `these are classified both ways, so the two gates contradict themselves: ${both.join(', ')}`,
    );
  });

  test('no policy entry points at a category the source no longer has', () => {
    // A renamed or retired code left behind in a policy set is not inert: it
    // keeps answering questions about a category that does not exist.
    const stale = [...INVOICE_REQUIRED_EXPENSE_TYPE_CODES, ...NO_INVOICE_EXPENSE_TYPE_CODES]
      .filter((code) => !SOURCE_CODES.includes(code));
    assert.deepEqual(stale, [], `policy names categories the catalog dropped: ${stale.join(', ')}`);
  });

  test('an unclassified category is a real defect, not a default — prove the policy reads the sets', () => {
    // Guards the guard: if someone "fixes" the sweep by making
    // expenseTypeSeedPolicy return a default, the two sets above would still
    // look fine while every category silently became optional. This asserts the
    // policy is genuinely membership-driven, using a code that is in neither.
    const ghost = 'ZZ_NOT_A_REAL_CATEGORY';
    assert.equal(expenseTypeSeedPolicy(ghost).requiresInvoice, false);
    assert.equal(expenseTypeSeedPolicy(ghost).substituteEvidenceAllowed, false);
    // …and that a real one differs, so the previous two lines are not just
    // what the function always returns.
    assert.equal(expenseTypeSeedPolicy('CUSTOMS').requiresInvoice, true, 'CUSTOMS is a documented service');
    assert.equal(
      expenseTypeSeedPolicy('ZONE_SURCHARGE').substituteEvidenceAllowed,
      true,
      'a zone surcharge is a computed rate, not a vendor bill',
    );
  });

  test('every category carries the metadata the entry screens render', () => {
    // "Nhập được" (enterable) means the row can be shown and saved: a code with
    // no name or no billing label renders blank in the picker, which reads as a
    // broken option rather than a missing one.
    const broken = SOURCE_CODES.filter((code) => {
      const meta = OPS_EXPENSE_TYPE_DEFAULTS[code];
      return !meta?.name?.trim() || !meta?.billingLabel?.trim();
    });
    assert.deepEqual(
      broken,
      [],
      `these categories have no name or no billingLabel, so they render blank on entry: ${broken.join(', ')}`,
    );
  });
});
