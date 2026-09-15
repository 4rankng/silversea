import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { documentLedgerAdjustment } from '../services/billing-document.service';
import { evaluateRecoverableEligibility } from '../services/recoverable-cost.service';
import { DURABLE_EFFECT_KIND } from '../services/durable-effect.service';
import { isValidTransition } from '../services/debit-note-lifecycle.service';

const eligible = {
  approvalStatus: 'RECORDED',
  sellAmount: 1_200_000,
  recoverablePrincipalAmount: 1_000_000,
  serviceFeeAmount: 200_000,
  expenseDate: '2026-07-31',
  requiresInvoice: true,
  substituteEvidenceAllowed: true,
  invoiceNumber: 'INV-001',
  invoiceDate: '2026-07-31',
  noInvoiceEvidenceTypes: [],
  claimDocumentId: null,
  claimDocumentStatus: null,
  claimSourceVersion: null,
  currentSourceVersion: 'expense:v1',
} as const;

describe('recoverable-cost and Debit Note policy', () => {
  test('requires explicit principal/service-fee classification before billing', () => {
    assert.deepEqual(evaluateRecoverableEligibility(eligible), {
      state: 'ELIGIBLE',
      blockedReason: null,
    });
    assert.equal(
      evaluateRecoverableEligibility({ ...eligible, serviceFeeAmount: null }).state,
      'BLOCKED',
    );
  });

  test('requires completion of legacy drafts, never an approval decision', () => {
    for (const approvalStatus of ['PENDING', 'DRAFT', 'VOIDED', 'REJECTED']) {
      const result = evaluateRecoverableEligibility({ ...eligible, approvalStatus });
      assert.equal(result.state, 'BLOCKED');
      assert.doesNotMatch(result.blockedReason ?? '', /phê duyệt/);
    }
    assert.equal(evaluateRecoverableEligibility({ ...eligible, approvalStatus: 'APPROVED' }).state, 'ELIGIBLE');
  });

  test('detects a claimed source that changed after issue as adjustment-only', () => {
    const result = evaluateRecoverableEligibility({
      ...eligible,
      claimDocumentId: 42,
      claimDocumentStatus: 'SENT',
      claimSourceVersion: 'expense:v0',
    });
    assert.equal(result.state, 'ADJUSTMENT_REQUIRED');
  });

  test('does not post recoverable expense again after trip-lock authority posted it', () => {
    const delta = documentLedgerAdjustment([
      {
        sourceType: 'TRIP', sourceId: 1, lineType: 'FREIGHT', typeLabel: 'Doanh thu',
        unit: 'chuyến', description: 'Cước', baseAmount: 5_000_000,
        amountOverride: null, excluded: false, sortOrder: 0,
      },
      {
        sourceType: 'EXPENSE', sourceId: 2, lineType: 'SERVICE_FEE', typeLabel: 'Phí chi hộ',
        unit: 'lần', description: 'THC', baseAmount: 1_200_000,
        amountOverride: null, excluded: false, sortOrder: 1,
      },
    ]);
    assert.equal(delta, 0);
  });

  test('keeps SENT and PENDING_CONFIRM distinct and registers the reference-only durable kind', () => {
    assert.equal(isValidTransition('SENT', 'PENDING_CONFIRM'), true);
    assert.equal(isValidTransition('SENT', 'CONFIRMED'), false);
    assert.equal(DURABLE_EFFECT_KIND.LEGAL_INVOICE_HANDOFF, 'LEGAL_INVOICE_HANDOFF');
  });
});
