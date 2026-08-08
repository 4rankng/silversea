import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { accountantSettlementExpensePatchSchema, tripExpensePatchSchema, tripExpenseSchema } from '@tingting/shared';
import { getTripExpenseRequiredFieldError } from '../services/forwarder.service';

describe('forwarder expense validation', () => {
  test('accepts OPS_ADVANCE when the route injects the authenticated forwarder id', () => {
    const parsed = tripExpenseSchema.safeParse({
      tripId: 1,
      expenseType: 'LIFTING',
      buyAmount: 1_500_000,
      sellAmount: 1_500_000,
      settlementMethod: 'OPS_ADVANCE',
      forwarderId: 42,
      invoiceNumber: '1664',
      invoiceDate: '2026-06-28',
      tripContainerId: 7,
    });

    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.forwarderId, 42);
  });

  test('still rejects OPS_ADVANCE without a forwarder counterparty', () => {
    const parsed = tripExpenseSchema.safeParse({
      tripId: 1,
      expenseType: 'LIFTING',
      buyAmount: 1_500_000,
      sellAmount: 1_500_000,
      settlementMethod: 'OPS_ADVANCE',
    });

    assert.equal(parsed.success, false);
    if (parsed.success) return;
    assert.equal(parsed.error.issues[0]?.path.join('.'), 'forwarderId');
  });

  test('requires complete substitute evidence when no invoice is provided', () => {
    const incomplete = tripExpenseSchema.safeParse({
      tripId: 1,
      expenseType: 'LIFTING',
      buyAmount: 500_000,
      forwarderId: 42,
    });
    assert.equal(incomplete.success, false);
    if (!incomplete.success) {
      assert.deepEqual(
        new Set(incomplete.error.issues.map((issue) => issue.path.join('.'))),
        new Set(['expenseDate', 'payeeName', 'note', 'noInvoiceEvidenceTypes']),
      );
    }

    const complete = tripExpenseSchema.safeParse({
      tripId: 1,
      expenseType: 'LIFTING',
      buyAmount: 500_000,
      forwarderId: 42,
      expenseDate: '2026-07-28',
      payeeName: 'Cảng Hải Phòng',
      note: 'Phí nâng container',
      noInvoiceEvidenceTypes: ['ONSITE_PHOTO'],
    });
    assert.equal(complete.success, true);
  });

  test('accepts null for nullable fields when clearing them during an expense update', () => {
    const parsed = tripExpensePatchSchema.safeParse({
      expenseType: 'LIFTING',
      buyAmount: 1_782_000,
      sellAmount: 1_782_000,
      settlementMethod: 'OPS_ADVANCE',
      supplierId: null,
      invoiceNumber: null,
      invoiceDate: null,
      declarationNumber: null,
      containerNumber: null,
      tripContainerId: null,
      note: null,
    });

    assert.equal(parsed.success, true);
  });

  test('accountant settlement adjustments share the nullable expense patch contract', () => {
    const parsed = accountantSettlementExpensePatchSchema.safeParse({
      expectedVersion: 1,
      buyAmount: 1_782_000,
      supplierId: null,
      invoiceNumber: null,
      note: null,
      adjustmentReason: 'Cập nhật theo hóa đơn',
    });

    assert.equal(parsed.success, true);
  });

  test('merged expense state preserves the required CUSTOMS declaration', () => {
    assert.equal(getTripExpenseRequiredFieldError({
      expenseType: 'CUSTOMS',
      declarationNumber: null,
    }), 'Số tờ khai là bắt buộc cho phí hải quan');

    assert.equal(getTripExpenseRequiredFieldError({
      expenseType: 'LIFTING',
      declarationNumber: null,
    }), null);

    assert.equal(getTripExpenseRequiredFieldError({
      expenseType: 'CUSTOMS',
      declarationNumber: 'TK-3509',
    }), null);
  });
});
