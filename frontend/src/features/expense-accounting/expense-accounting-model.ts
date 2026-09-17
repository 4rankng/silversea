import type { ExpenseAccountingEntry, ExpenseSourceRef } from '@tingting/shared';
import { formatCurrency } from '../../lib/format';

export function expenseKey(entry: Pick<ExpenseAccountingEntry, 'sourceKind' | 'sourceId'>): string {
  return `${entry.sourceKind}:${entry.sourceId}`;
}
export function sourceRef(entry: ExpenseAccountingEntry): ExpenseSourceRef {
  return { sourceKind: entry.sourceKind, sourceId: entry.sourceId, expectedVersion: entry.version };
}
export function expenseMoney(value: number | null | undefined): string {
  return value == null ? 'Chưa xác định' : formatCurrency(value);
}
export function voucherSelectionIssue(entries: ExpenseAccountingEntry[], direction: 'IN' | 'OUT'): string | null {
  if (!entries.length) return 'Chọn ít nhất một khoản chi.';
  if (entries.some(entry => entry.status !== 'RECORDED')) return 'Có khoản đã hủy. Mở lại để kiểm tra.';
  const parties = new Set(entries.map(entry => direction === 'IN'
    ? `CUSTOMER:${entry.customerId}`
    : `${entry.payableEntityType}:${entry.payableEntityId}`));
  if (parties.size !== 1) return direction === 'IN' ? 'Một phiếu thu chỉ gồm một khách hàng.' : 'Một phiếu chi chỉ gồm một đối tượng nhận tiền.';
  if (direction === 'OUT' && entries.some(entry => !entry.payableEntityType || !entry.payableEntityId)) return 'Chưa xác định người nhận tiền của khoản chi.';
  const amounts = entries.map(entry => direction === 'IN' ? entry.outstandingReceivable : entry.outstandingPayable);
  if (amounts.some(amount => amount == null)) return 'Số còn lại chưa xác định. Hoàn thiện thông tin tài chính trước khi lập phiếu.';
  if (amounts.some(amount => Number(amount) <= 0)) return 'Có khoản không còn số tiền để thu / trả.';
  return null;
}

export function validAllocation(amount: number | '', remaining: number | null | undefined) {
  return remaining != null && amount !== '' && Number.isSafeInteger(amount) && amount > 0 && amount <= remaining;
}

/** Each cash voucher belongs to one counterparty. Keep incompatible groups explicit. */
export function groupVoucherEntries(entries: ExpenseAccountingEntry[], direction: 'IN' | 'OUT') {
  const groups = new Map<string, { key: string; label: string; entries: ExpenseAccountingEntry[] }>();
  entries.forEach(entry => {
    const key = direction === 'IN' ? `CUSTOMER:${entry.customerId}` : `${entry.payableEntityType}:${entry.payableEntityId}`;
    const group = groups.get(key) ?? { key, label: direction === 'IN' ? entry.customerName : entry.payerName ?? 'Chưa xác định đối tượng nhận tiền', entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  });
  return [...groups.values()];
}
