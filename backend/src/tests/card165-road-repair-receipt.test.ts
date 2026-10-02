// Card 20260928_165 AC4 — the road-repair fee ("phí sửa chữa dọc đường") is
// tied to its hand-written receipt: one catalog identity, one evidence kind,
// exactly one seed policy class. The lesson this wave already paid for: a new
// expense code that joins the catalog WITHOUT joining a policy class lands in
// the contradictory requiresInvoice:false + substituteEvidenceAllowed:false
// state (card 20260928_181, CUSTOMS/ZONE_SURCHARGE) — the class and the row
// must move together.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
  DRIVER_LOT_COST_EXPENSE_TYPES,
  NO_INVOICE_EVIDENCE_TYPE_LABELS,
  OPS_EXPENSE_TYPE_DEFAULTS,
  RECEIPT_EVIDENCE_EXPENSE_TYPE_CODES,
  ROAD_REPAIR_EVIDENCE_TYPE,
  ExpenseTypeCategory,
  driverLotCostIsInvoiced,
} from '@tingting/shared';
import { expenseTypeSeedPolicy } from '../expense-type-seed-policy';

describe('card 20260928_165 — road-repair receipt tie', () => {
  test('the fee exists in the catalog AND in the driver class table', () => {
    assert.equal(OPS_EXPENSE_TYPE_DEFAULTS.ROAD_REPAIR?.name, 'Phí sửa chữa dọc đường');
    assert.equal(OPS_EXPENSE_TYPE_DEFAULTS.ROAD_REPAIR?.category, ExpenseTypeCategory.REPAIR_ADVANCE);
    // The driver form hides the invoice field off this table: a receipt-backed
    // fee must never be classified as invoice-bearing.
    assert.equal(driverLotCostIsInvoiced('ROAD_REPAIR'), false);
    assert.ok(DRIVER_LOT_COST_EXPENSE_TYPES.some((type) => type.code === 'ROAD_REPAIR'));
  });

  test('exactly one seed policy class — never the silent middle', () => {
    const policy = expenseTypeSeedPolicy('ROAD_REPAIR');
    assert.equal(policy.requiresInvoice, false);
    assert.equal(policy.substituteEvidenceAllowed, true);
  });

  test('its supporting document is the hand-written receipt, mapped once', () => {
    assert.equal(RECEIPT_EVIDENCE_EXPENSE_TYPE_CODES.ROAD_REPAIR, ROAD_REPAIR_EVIDENCE_TYPE);
    assert.equal(ROAD_REPAIR_EVIDENCE_TYPE, 'RECEIPT');
    assert.ok(DEFAULT_NO_INVOICE_EVIDENCE_TYPES.includes(ROAD_REPAIR_EVIDENCE_TYPE));
    assert.equal(NO_INVOICE_EVIDENCE_TYPE_LABELS[ROAD_REPAIR_EVIDENCE_TYPE], 'Phiếu thu / biên nhận / vé lẻ');
    assert.equal(RECEIPT_EVIDENCE_EXPENSE_TYPE_CODES.NOT_A_FEE_CODE, undefined);
  });
});
