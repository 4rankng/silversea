import { describe, expect, it } from 'vitest';
import { AdvanceSettlementStatus } from '@tingting/shared';
import { settlementBalanceSummary, settlementReviewPermissions } from './SettlementPrintPage';

describe('advance-settlement maker/checker/approver UI policy', () => {
  it('shows the persisted refund separately from the remaining settlement difference', () => {
    expect(settlementBalanceSummary(700_000, 630_000, 70_000)).toEqual({
      balance: 0,
      label: 'Chênh lệch sau quyết toán',
    });
    expect(settlementBalanceSummary(700_000, 630_000, 0)).toEqual({
      balance: 70_000,
      label: 'Còn dư chưa hoàn',
    });
  });

  it('lets a financial reviewer edit and check a pending settlement, but not approve it', () => {
    expect(settlementReviewPermissions({
      isPortal: false,
      userId: 20,
      role: 'ACCOUNTANT',
      settlement: {
        status: AdvanceSettlementStatus.PENDING,
        checkedBy: null,
        forwarderId: 10,
      },
    })).toEqual({ canEditAndCheck: true, canApprove: false, canRequestApprovedGovernance: false });
  });

  it('lets a distinct financial reviewer approve a checked settlement', () => {
    expect(settlementReviewPermissions({
      isPortal: false,
      userId: 30,
      role: 'ADMIN',
      settlement: {
        status: AdvanceSettlementStatus.CHECKED_BY_ACCOUNTANT,
        checkedBy: 20,
        forwarderId: 10,
      },
    })).toEqual({ canEditAndCheck: false, canApprove: true, canRequestApprovedGovernance: false });
  });

  it.each([
    { label: 'the checker', userId: 20, role: 'ACCOUNTANT', isPortal: false },
    { label: 'the maker', userId: 10, role: 'ADMIN', isPortal: false },
    { label: 'a viewer', userId: 30, role: 'MANAGER', isPortal: false },
    { label: 'a portal user', userId: 30, role: 'ACCOUNTANT', isPortal: true },
  ])('does not expose approval to $label', ({ userId, role, isPortal }) => {
    expect(settlementReviewPermissions({
      isPortal,
      userId,
      role,
      settlement: {
        status: AdvanceSettlementStatus.CHECKED_BY_ACCOUNTANT,
        checkedBy: 20,
        forwarderId: 10,
      },
    }).canApprove).toBe(false);
  });

  it('does not expose approval when a legacy checked row has no checker identity', () => {
    expect(settlementReviewPermissions({
      isPortal: false,
      userId: 30,
      role: 'ADMIN',
      settlement: {
        status: AdvanceSettlementStatus.CHECKED_BY_ACCOUNTANT,
        checkedBy: null,
        forwarderId: 10,
      },
    }).canApprove).toBe(false);
  });
});
