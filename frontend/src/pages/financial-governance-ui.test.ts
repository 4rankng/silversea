import { describe, expect, it } from 'vitest';
import { AdvanceSettlementStatus, AdvanceRequestStatus, ADVANCE_REQUEST_STATUS_LABELS, Role } from '@tingting/shared';
import { settlementActionPermissions } from './SettlementPrintPage';

describe('direct financial action permissions', () => {
  it('exposes direct advance records and unresolved historical drafts without review states', () => {
    expect(Object.values(AdvanceRequestStatus)).toEqual(['RECORDED', 'DRAFT', 'VOIDED']);
    expect(ADVANCE_REQUEST_STATUS_LABELS.DRAFT).toBe('Chưa ghi sổ');
    expect(Object.values(ADVANCE_REQUEST_STATUS_LABELS).join(' ')).not.toMatch(/duyệt|Từ chối/);
  });

  it.each([Role.ACCOUNTANT, Role.ADMIN])('lets %s record drafts and correct recorded settlements directly', (role) => {
    expect(settlementActionPermissions({
      isPortal: false,
      role,
      settlement: { status: AdvanceSettlementStatus.DRAFT },
    })).toEqual({ canEditDraft: true, canCorrectRecorded: false });
    expect(settlementActionPermissions({
      isPortal: false,
      role,
      settlement: { status: AdvanceSettlementStatus.RECORDED },
    })).toEqual({ canEditDraft: false, canCorrectRecorded: true });
    expect(settlementActionPermissions({
      isPortal: false,
      role,
      settlement: { status: AdvanceSettlementStatus.VOIDED },
    })).toEqual({ canEditDraft: false, canCorrectRecorded: false });
  });

  it.each([Role.CUS, Role.DISPATCHER, Role.DRIVER, Role.OPS, undefined])('does not grant financial actions to %s when approval is removed', (role) => {
    for (const status of Object.values(AdvanceSettlementStatus)) {
      expect(settlementActionPermissions({ isPortal: false, role, settlement: { status } }))
        .toEqual({ canEditDraft: false, canCorrectRecorded: false });
    }
  });

  it.each([Role.ACCOUNTANT, Role.ADMIN])('keeps %s portal history read-only', (role) => {
    for (const status of Object.values(AdvanceSettlementStatus)) {
      expect(settlementActionPermissions({ isPortal: true, role, settlement: { status } }))
        .toEqual({ canEditDraft: false, canCorrectRecorded: false });
    }
  });
});
