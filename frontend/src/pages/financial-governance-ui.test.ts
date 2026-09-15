import { describe, expect, it } from 'vitest';
import { AdvanceSettlementStatus, AdvanceRequestStatus, ADVANCE_REQUEST_STATUS_LABELS, Role } from '@tingting/shared';
import { settlementReviewPermissions } from './SettlementPrintPage';

describe('financial governance UI policy', () => {
  it('exposes direct advance records and unresolved historical drafts without review states', () => {
    expect(Object.values(AdvanceRequestStatus)).toEqual(['RECORDED', 'DRAFT', 'VOIDED']);
    expect(ADVANCE_REQUEST_STATUS_LABELS.DRAFT).toBe('Chưa ghi sổ');
    expect(Object.values(ADVANCE_REQUEST_STATUS_LABELS).join(' ')).not.toMatch(/duyệt|Từ chối/);
  });

  it('offers correction and reversal initiation only for approved settlements to finance reviewers', () => {
    expect(settlementReviewPermissions({
      isPortal: false,
      userId: 2,
      role: Role.ACCOUNTANT,
      settlement: { status: AdvanceSettlementStatus.RECORDED, checkedBy: 3, forwarderId: 1 },
    }).canRequestApprovedGovernance).toBe(true);
    expect(settlementReviewPermissions({
      isPortal: true,
      userId: 2,
      role: Role.ACCOUNTANT,
      settlement: { status: AdvanceSettlementStatus.RECORDED, checkedBy: 3, forwarderId: 1 },
    }).canRequestApprovedGovernance).toBe(false);
  });
});
