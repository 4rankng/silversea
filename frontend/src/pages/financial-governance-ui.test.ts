import { describe, expect, it } from 'vitest';
import { AdvanceSettlementStatus, AdvanceRequestStatus, ADVANCE_REQUEST_STATUS_LABELS, Role } from '@tingting/shared';
import { settlementActionPermissions } from './SettlementPrintPage';

describe('direct financial action permissions', () => {
  it('models the advance-request approval step (PENDING → RECORDED/VOIDED) added by KP-148', () => {
    // Step 9 (KP-148): Ops tạo yêu cầu tạm ứng ở PENDING ("Chờ phê duyệt") —
    // không còn ghi thẳng vào RECORDED. Kế toán duyệt mới ghi sổ; từ chối thì
    // VOIDED. DRAFT/VOIDED giữ nguyên ngữ nghĩa lịch sử.
    expect(Object.values(AdvanceRequestStatus)).toEqual(['PENDING', 'RECORDED', 'DRAFT', 'VOIDED']);
    expect(ADVANCE_REQUEST_STATUS_LABELS.DRAFT).toBe('Chưa ghi sổ');
    expect(ADVANCE_REQUEST_STATUS_LABELS.PENDING).toBe('Chờ phê duyệt');
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
