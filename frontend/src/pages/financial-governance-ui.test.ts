import { describe, expect, it } from 'vitest';
import { AdvanceSettlementStatus, Role } from '@tingting/shared';
import { buildAdvanceDecision } from './AdminAdvancesPage';
import { settlementReviewPermissions } from './SettlementPrintPage';

describe('financial governance UI policy', () => {
  it('requires and trims a typed reason for advance decisions', () => {
    expect(buildAdvanceDecision({ id: 12, version: 4 }, '   ')).toBeNull();
    expect(buildAdvanceDecision({ id: 12, version: 4 }, '  Sai chứng từ  ')).toEqual({
      id: 12,
      expectedVersion: 4,
      reason: 'Sai chứng từ',
    });
  });

  it('offers correction and reversal initiation only for approved settlements to finance reviewers', () => {
    expect(settlementReviewPermissions({
      isPortal: false,
      userId: 2,
      role: Role.ACCOUNTANT,
      settlement: { status: AdvanceSettlementStatus.APPROVED, checkedBy: 3, forwarderId: 1 },
    }).canRequestApprovedGovernance).toBe(true);
    expect(settlementReviewPermissions({
      isPortal: true,
      userId: 2,
      role: Role.ACCOUNTANT,
      settlement: { status: AdvanceSettlementStatus.APPROVED, checkedBy: 3, forwarderId: 1 },
    }).canRequestApprovedGovernance).toBe(false);
  });
});
