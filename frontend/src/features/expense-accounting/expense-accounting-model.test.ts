import { describe, expect, it } from 'vitest';
import type { ExpenseAccountingEntry } from '@tingting/shared';
import { expenseMoney, hasConfirmEvidence, isConfirmableEntry, validAllocation, voucherFundIssue, voucherSelectionIssue, groupVoucherEntries } from './expense-accounting-model';

const row = (changes: Partial<ExpenseAccountingEntry> = {}) => ({
  sourceKind: 'OPS', sourceId: 1, version: 1, customerId: 12, status: 'RECORDED', locked: false,
  payableEntityType: 'FORWARDER', payableEntityId: 3, outstandingReceivable: 300000, outstandingPayable: 500000,
  // SIL-1097 — dòng mang sẵn biên lai để các case trạng thái bên dưới nói về
  // đúng TRẠNG THÁI; luật bằng chứng có case riêng.
  invoiceNumber: null, photoStorageKeys: ['receipt.jpg'], evidenceMissing: false,
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

describe('isConfirmableEntry — card 20260928_168 AC2', () => {
  it('a pending row may join a confirm batch', () => {
    expect(isConfirmableEntry(row())).toBe(true);
  });
  it('an approved row keeps status RECORDED and must still be refused', () => {
    expect(isConfirmableEntry(row({ confirmedAt: '2026-09-21T02:00:00.000Z', confirmedById: 9 }))).toBe(false);
  });
  it('a voided row is refused', () => {
    expect(isConfirmableEntry(row({ status: 'VOIDED' }))).toBe(false);
  });
});

describe('isConfirmableEntry / hasConfirmEvidence — QA 28/11 finding 02 (evidence display-only)', () => {
  const bare = { invoiceNumber: null, photoStorageKeys: [], evidenceMissing: true } as Partial<ExpenseAccountingEntry>;
  it('an evidence-less row still joins the confirm batch (Nov 22 approval rule)', () => {
    // The evidence STATE is still classified (display beside the action)…
    expect(hasConfirmEvidence(row(bare))).toBe(false);
    // …but it never gates confirmability — the server accepts the row as-is.
    expect(isConfirmableEntry(row(bare))).toBe(true);
  });
  it('có biên lai (ảnh/tài liệu) thì không cần hóa đơn', () => {
    expect(hasConfirmEvidence(row({ invoiceNumber: null, photoStorageKeys: ['a.jpg'], evidenceMissing: false }))).toBe(true);
    expect(isConfirmableEntry(row({ invoiceNumber: null, photoStorageKeys: ['a.jpg'], evidenceMissing: false }))).toBe(true);
  });
  it('đính kèm chứng từ không nằm trong photoStorageKeys vẫn là bằng chứng', () => {
    // reads.service: evidenceMissing=false khi còn attachment dù ảnh nguồn rỗng.
    expect(hasConfirmEvidence(row({ invoiceNumber: null, photoStorageKeys: [], evidenceMissing: false }))).toBe(true);
  });
  it('có số hóa đơn thì không cần ảnh', () => {
    expect(hasConfirmEvidence(row({ invoiceNumber: 'HD-777', photoStorageKeys: [], evidenceMissing: true }))).toBe(true);
    expect(isConfirmableEntry(row({ invoiceNumber: 'HD-777', photoStorageKeys: [], evidenceMissing: true }))).toBe(true);
  });
  it('bảng Ops khai bằng chứng qua hasPhoto — chuỗi rỗng/space không phải hóa đơn', () => {
    expect(hasConfirmEvidence({ invoiceNumber: '   ', hasPhoto: true })).toBe(true);
    expect(hasConfirmEvidence({ invoiceNumber: '   ', hasPhoto: false })).toBe(false);
    expect(hasConfirmEvidence({ invoiceNumber: 'HD-1', hasPhoto: false })).toBe(true);
  });
});

describe('voucherFundIssue — SIL-1098 (K5.35: sai nguồn quỹ → từ chối kèm tên dòng)', () => {
  const line = (costGroup: ExpenseAccountingEntry['costGroup'], feeName: string) => ({ costGroup, feeName });
  it('chọn sai nguồn quỹ: nêu tên dòng sai quỹ và quỹ bắt buộc', () => {
    const issue = voucherFundIssue([line('INVOICED_LIFT', 'Nâng vỏ')], 'COMPANY');
    expect(issue).toContain('Sai nguồn quỹ');
    expect(issue).toContain('Nâng vỏ (Nâng có hóa đơn)');
    expect(issue).toContain('Quỹ tiền mặt');
  });
  it('chọn đúng quỹ thì không chặn', () => {
    expect(voucherFundIssue([line('INVOICED_LIFT', 'Nâng vỏ')], 'TM')).toBeNull();
    expect(voucherFundIssue([line('DRIVER_ROAD', 'Vé cầu đường')], 'COMPANY')).toBeNull();
  });
  it('trộn hai nguồn quỹ: yêu cầu tách phiếu, nêu tên dòng cả hai phía', () => {
    const issue = voucherFundIssue([line('INVOICED_LIFT', 'Nâng vỏ'), line('DRIVER_ROAD', 'Vé cầu đường')], 'TM');
    expect(issue).toContain('tách phiếu');
    expect(issue).toContain('Nâng vỏ (Nâng có hóa đơn)');
    expect(issue).toContain('Vé cầu đường (Tiền đường)');
  });
  it('dòng chưa phân loại không phán xét; chưa chọn quỹ thì chưa chặn', () => {
    expect(voucherFundIssue([line(null, 'Chưa phân loại')], 'COMPANY')).toBeNull();
    expect(voucherFundIssue([line('INVOICED_LIFT', 'Nâng vỏ')], '')).toBeNull();
  });
  it('tên dòng trống thì gọi tên theo nhóm (K5.35: dòng "Nâng có hóa đơn")', () => {
    expect(voucherFundIssue([line('INVOICED_LIFT', '  ')], 'COMPANY')).toContain('"Nâng có hóa đơn"');
  });
});
