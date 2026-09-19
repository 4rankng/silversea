import { useQueries } from '@tanstack/react-query';
import type { ExpenseReconciliation, ExpenseSourceRef, ExpenseVoucher } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { formatDate } from '../../lib/format';
import { expenseMoney } from './expense-accounting-model';

function SourceRows({ sources }: { sources: Array<ExpenseSourceRef & { amount?: number }> }) {
  const queries = useQueries({ queries: sources.map(source => ({
    queryKey: ['expense-accounting', 'entry', source.sourceKind, source.sourceId],
    queryFn: () => expenseAccountingClient.get(source),
  })) });
  return <div className="expense-accounting-history">{sources.map((source, index) => {
    const query = queries[index];
    return <article key={`${source.sourceKind}:${source.sourceId}`}>
      <strong>{query.data?.feeName ?? '—'}</strong>
      <span>{query.data?.shipmentCode ?? ''} {query.data?.containerNumber ?? ''}</span>
      <small>Nguồn {source.sourceKind} · phiên bản {source.expectedVersion}</small>
      {source.amount !== undefined && <strong>Phân bổ: {expenseMoney(source.amount)}</strong>}
      {query.data && <span>Thực chi hiện tại: {expenseMoney(query.data.amount)}</span>}
      {query.isPending && <span role="status">Đang tải khoản chi…</span>}
      {query.isError && <p role="alert">Không tải được nội dung nguồn. Tham chiếu và phân bổ lịch sử vẫn được giữ. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void query.refetch()}>Thử lại</button></p>}
    </article>;
  })}{!sources.length && <p>Không có phân bổ khoản chi. Không tự suy đoán phân bổ dữ liệu cũ.</p>}</div>;
}

export function ExpenseHistoryDetail({ item, onClose }: { item: ExpenseVoucher | ExpenseReconciliation; onClose: () => void }) {
  const voucher = 'direction' in item ? item : null;
  return <Drawer isOpen title={`Chi tiết ${item.code}`} onClose={onClose} className="expense-accounting-drawer">
    {'voidedAt' in item && item.voidedAt && <p className="expense-accounting-hint">Đã hoàn tác ngày {formatDate(item.voidedAt)}. Đây là thông tin đợt đối chiếu cũ, không còn khoản phải thanh toán trên đợt này.</p>}
    <dl className="expense-accounting-facts">
      <div><dt>{voucher ? 'Số tiền ghi phiếu' : 'Thực chi đối chiếu'}</dt><dd>{expenseMoney(item.amount)}</dd></div>
      {voucher && <><div><dt>Quỹ / tài khoản</dt><dd>{voucher.treasuryAccountName ?? '—'}</dd></div><div><dt>Ngày ghi tiền</dt><dd>{formatDate(voucher.valueDate)}</dd></div><div><dt>Tham chiếu gốc</dt><dd>{voucher.physicalReference}</dd></div></>}
      {!voucher && 'advanceAmount' in item && <><div><dt>Ứng phân bổ</dt><dd>{expenseMoney(item.advanceAmount)}</dd></div><div><dt>Đã trả thêm / đã hoàn</dt><dd>{expenseMoney(item.paidAmount)} / {expenseMoney(item.refundedAmount)}</dd></div><div><dt>Chênh lệch còn lại</dt><dd>{expenseMoney(item.remainingDifference)}</dd></div></>}
    </dl>
    {voucher?.reversal && <section className="expense-accounting-notes" aria-label="Giao dịch đảo"><strong>Đã đảo phiếu</strong><span>{formatDate(voucher.reversal.valueDate)} · {expenseMoney(voucher.reversal.amount)}</span><span>Tham chiếu: {voucher.reversal.physicalReference}</span><p>Lý do: {voucher.reversal.reason ?? '—'}</p></section>}
    {item.note && <p className="expense-accounting-hint">{item.note}</p>}
    {!voucher && 'advanceAmount' in item && <section aria-label="Các khoản ứng đã phân bổ" className="expense-accounting-history">
      <h3 className="expense-accounting-subtitle">Các khoản ứng đã phân bổ</h3>
      {item.advances?.map(advance => <article key={advance.advanceRequestId}>
        {/* business key render; id never user-facing — the history advance payload carries no date/requester name */}
        <header><strong>Ứng</strong><strong>{expenseMoney(advance.amount)}</strong></header>
        {advance.reason && <p>{advance.reason}</p>}
      </article>)}
      {!item.advances?.length && <p>{item.advanceAmount > 0 ? 'Chưa có phân bổ ứng chi tiết trong lịch sử. Không tự suy đoán từ tổng tiền.' : 'Không sử dụng tiền ứng cho đợt này.'}</p>}
    </section>}
    <h3 className="expense-accounting-subtitle">Các khoản nguồn</h3><SourceRows sources={item.entries} />
  </Drawer>;
}
