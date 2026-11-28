import type { ExpenseAccountingEntry, ExpenseSourceRef, TreasuryFundCode } from '@tingting/shared';
import { EXPENSE_COST_GROUP_REQUIRED_FUND, expenseCostLineName, treasuryFundLabel } from '@tingting/shared';
import { formatCurrency } from '../../lib/format';

export function expenseKey(entry: Pick<ExpenseAccountingEntry, 'sourceKind' | 'sourceId'>): string {
  return `${entry.sourceKind}:${entry.sourceId}`;
}
export function sourceRef(entry: ExpenseAccountingEntry): ExpenseSourceRef {
  return { sourceKind: entry.sourceKind, sourceId: entry.sourceId, expectedVersion: entry.version };
}
/** Card 20260928_168 AC2 — the ONE rule behind every "selectable" set on the
 *  expense register: a row may join a confirm batch. An approved row keeps
 *  `status: 'RECORDED'` and only gains `confirmedAt`, so a `status`-only
 *  predicate re-selects it and the batch is refused wholesale
 *  (`Khoản … đã đối chiếu.`). Ticket-all, page-all and the per-row checkbox
 *  all read this helper so the three can never drift apart.
 *
 *  SIL-1097 (KB §3.5.4 K3.71 — "không hóa đơn ≠ không cần biên lai"): ngoài
 *  trạng thái, dòng phải có BẰNG CHỨNG (số hóa đơn hoặc biên lai ảnh/tài
 *  liệu) mới được đưa vào đợt xác nhận — thiếu cả hai thì server từ chối nên
 *  một dòng như vậy lọt vào batch sẽ làm chết cả batch. */
export type ConfirmEvidenceFields = Pick<ExpenseAccountingEntry, 'invoiceNumber'> &
  Partial<Pick<ExpenseAccountingEntry, 'photoStorageKeys' | 'evidenceMissing'>> & { hasPhoto?: boolean };

/** Bằng chứng trước khi đối chiếu: có số hóa đơn, hoặc có biên lai ảnh/tài
 *  liệu. Ba bề mặt nạp bằng chứng theo ba dạng trường khác nhau — bảng đăng
 *  ký / đối soát mang `photoStorageKeys` + `evidenceMissing`, bảng Ops mang
 *  `hasPhoto`. DISPLAY-only since QA 28/11 finding 02: evidence never gates
 *  the confirm (the Nov 22 approval rule — "Kế toán bấm được nút duyệt ngay
 *  cả khi khoản chi chưa đính kèm đủ hình ảnh chứng từ"); the row's evidence
 *  state stays visible beside the action. */
export function hasConfirmEvidence(entry: ConfirmEvidenceFields): boolean {
  return Boolean(entry.invoiceNumber?.trim())
    || entry.hasPhoto === true
    || (entry.photoStorageKeys?.length ?? 0) > 0
    || entry.evidenceMissing === false;
}
export function isConfirmableEntry(entry: Pick<ExpenseAccountingEntry, 'status' | 'confirmedAt'> & ConfirmEvidenceFields): boolean {
  // QA 28/11 finding 02 — status/confirmedAt decide confirmability; evidence
  // is displayed, never required (the server accepts the row as-is).
  return entry.status === 'RECORDED' && !entry.confirmedAt;
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

/** SIL-1098 (KB §5.4.5 K5.35 = §6.2 K6.12, QuyTrinhO2C.md §7.5) — nguồn quỹ
 *  của phiếu phải khớp dòng chi: chọn sai thì phiếu bị từ chối và thông báo
 *  NÊU TÊN dòng sai quỹ (ví dụ: dòng "Nâng có hóa đơn" phải dùng Quỹ tiền
 *  mặt); phiếu trộn dòng hai nguồn bị từ chối kèm yêu cầu tách phiếu. Cùng
 *  bảng luật `EXPENSE_COST_GROUP_REQUIRED_FUND` + cách đặt tên dòng với guard
 *  server `assertVoucherFundMatches` — hai cổng không được lệch nhau. */
export function voucherFundIssue(entries: Array<Pick<ExpenseAccountingEntry, 'costGroup' | 'feeName'>>, fund: TreasuryFundCode | ''): string | null {
  const required = [...new Set(entries.map(entry => (entry.costGroup ? EXPENSE_COST_GROUP_REQUIRED_FUND[entry.costGroup] : undefined)).filter(Boolean))] as TreasuryFundCode[];
  if (!fund || required.length === 0) return null;
  const named = (wanted: TreasuryFundCode) => entries
    .filter(entry => entry.costGroup != null && EXPENSE_COST_GROUP_REQUIRED_FUND[entry.costGroup] === wanted)
    .map(entry => expenseCostLineName(entry.feeName, entry.costGroup));
  if (required.length > 1) {
    return `Phiếu này trộn hai nguồn quỹ nên không thể ghi vào một tài khoản. Cần ${treasuryFundLabel('COMPANY')}: ${named('COMPANY').join(', ') || '—'}; cần ${treasuryFundLabel('TM')}: ${named('TM').join(', ') || '—'}. Hãy tách phiếu.`;
  }
  const wanted = required[0];
  if (wanted === fund) return null;
  return `Sai nguồn quỹ: dòng ${named(wanted).map(name => `"${name}"`).join(', ')} phải dùng ${treasuryFundLabel(wanted)}.`;
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
