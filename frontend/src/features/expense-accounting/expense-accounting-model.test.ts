import { describe, expect, it } from 'vitest';
import type { ExpenseAccountingEntry } from '@tingting/shared';
import { expenseMoney, validAllocation, voucherSelectionIssue, groupVoucherEntries } from './expense-accounting-model';

const row = (changes: Partial<ExpenseAccountingEntry> = {}) => ({
  sourceKind: 'OPS', sourceId: 1, version: 1, customerId: 12, status: 'RECORDED', locked: false,
  payableEntityType: 'FORWARDER', payableEntityId: 3, outstandingReceivable: 300000, outstandingPayable: 500000,
  ...changes,
}) as ExpenseAccountingEntry;

describe('expense selection and money — AC-CP-KT-05/10/11', () => {
  it('keeps unknown amounts distinct from zero', () => {
    expect(expenseMoney(null)).toBe('Chưa xác định');
    expect(expenseMoney(0)).toContain('0');
    expect(validAllocation(1, null)).toBe(false);
  });
  it('supports partial payment up to the customer charge, not actual spend', () => {
    expect(validAllocation(100000, row().outstandingReceivable)).toBe(true);
    expect(validAllocation(400000, row().outstandingReceivable)).toBe(false);
    expect(voucherSelectionIssue([row()], 'IN')).toBeNull();
  });
  it('does not block cash settlement solely because the source accounting period is locked', () => {
    expect(voucherSelectionIssue([row({ locked: true })], 'IN')).toBeNull();
  });
  it('separates incompatible counterparties instead of posting one mixed voucher', () => {
    const groups = groupVoucherEntries([row(), row({ sourceId: 2, customerId: 14 }), row({ sourceId: 3 })], 'IN');
    expect(groups.map(group => group.entries.length)).toEqual([2, 1]);
    expect(voucherSelectionIssue([row(), row({ customerId: 14 })], 'IN')).toContain('một khách hàng');
  });
  it('rejects unresolved historical allocation and voided rows', () => {
    expect(voucherSelectionIssue([row({ outstandingReceivable: null })], 'IN')).toContain('chưa xác định');
    expect(voucherSelectionIssue([row({ status: 'VOIDED' })], 'OUT')).toContain('hủy');
  });
});
