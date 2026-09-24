import { useOpsFundBook } from '../../hooks/useOpsQueries';
import { formatVnd } from './opsStatus';
import { formatDate } from '../../lib/format';
import { OpsQueryFeedback } from './OpsQueryFeedback';

/**
 * Sổ quỹ (card 20260923_13, ADR 2026-09-24-ops-fund-book-scoped-read): read-only
 * listing of the caller's own tạm ứng/hoàn ứng cash events. The closing row and
 * the accountant figure ("Còn phải hoàn ứng") are shown together with an honest
 * khớp/chưa khớp state — the discrepancy is never auto-resolved.
 */
export function OpsFundBookSection() {
  const { data, isLoading, isError, refetch } = useOpsFundBook();
  const items = data?.items ?? [];

  return (
    <section className="ops-wallet__section" aria-label="Sổ quỹ">
      <header className="ops-wallet__section-head">
        <h2>Sổ quỹ</h2>
      </header>
      <p className="ops-modal-hint">Chỉ hiển thị các khoản tạm ứng/hoàn ứng của bạn; sổ chỉ đọc.</p>
      <OpsQueryFeedback loading={isLoading} error={isError} label="sổ quỹ" onRetry={refetch} />
      {items.length === 0 && !isLoading && !isError && (
        <p className="ops-modal-hint">Chưa có khoản tạm ứng/hoàn ứng nào được ghi sổ.</p>
      )}
      {items.length > 0 && (
        <div className="ops-wallet__scroll">
          <table className="tt-table ops-wallet__table">
            <thead>
              <tr>
                <th scope="col">Ngày</th>
                <th scope="col">Diễn giải</th>
                <th scope="col">Chứng từ</th>
                <th scope="col" style={{ textAlign: 'right' }}>Thu (nhận)</th>
                <th scope="col" style={{ textAlign: 'right' }}>Chi (trả)</th>
                <th scope="col" style={{ textAlign: 'right' }}>Số dư</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const value = Number(item.amount);
                const running = items.slice(0, index + 1).reduce((sum, entry) => sum + Number(entry.amount), 0);
                return (
                  <tr key={item.key}>
                    <td data-label="Ngày">{formatDate(item.date)}</td>
                    <td className="ops-wallet__wide" data-label="Diễn giải">{item.label}</td>
                    <td data-label="Chứng từ">{item.reference ?? '—'}</td>
                    <td className="ops-money" data-label="Thu (nhận)" style={{ textAlign: 'right' }}>{value > 0 ? formatVnd(value) : '—'}</td>
                    <td className="ops-money" data-label="Chi (trả)" style={{ textAlign: 'right' }}>{value < 0 ? formatVnd(-value) : '—'}</td>
                    <td className="ops-money" data-label="Số dư" style={{ textAlign: 'right' }}>{formatVnd(running)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <section className="ops-fund-book__summary" aria-label="Tổng sổ quỹ" style={{ marginTop: 12, display: 'grid', gap: 4, justifyContent: 'end', textAlign: 'right' }}>
          <span>Số dư cuối sổ: <strong className="mono">{formatVnd(Number(data.closing))} ₫</strong></span>
          <span>Còn phải hoàn ứng (theo kế toán): <strong className="mono">{formatVnd(Number(data.outstandingAdvanceBalance))} ₫</strong></span>
          <span style={{ color: data.matches ? 'var(--success-text)' : 'var(--err, #dc2626)' }}>
            {data.matches ? 'Đã khớp với báo cáo tổng hợp hoàn ứng' : 'Chưa khớp — cần đối chiếu với kế toán'}
            </span>
        </section>
      )}
    </section>
  );
}
