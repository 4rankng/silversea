import { useState } from 'react';
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
  // Card 20260928_168 (ruling PM 2026-09-29 câu 2): the sổ quỹ lọc theo kỳ.
  // Empty means "no window" — the whole history, exactly as before — so the
  // default view is unchanged and the picker is opt-in.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, isLoading, isError, refetch } = useOpsFundBook({
    from: from || undefined,
    to: to || undefined,
  });
  // A payload without `period` is not windowed. Reading it unguarded threw
  // `Cannot read properties of undefined (reading 'from')` on every render
  // that saw such a body — an unhandled error that took the whole wallet page
  // (and its test file) down with it (card 20260930_218).
  const windowed = Boolean(data?.period && (data.period.from !== null || data.period.to !== null));
  const items = data?.items ?? [];

  return (
    <section className="ops-wallet__section" aria-label="Sổ quỹ">
      <header className="ops-wallet__section-head">
        <h2>Sổ quỹ</h2>
        <div className="ops-fund-book__period">
          <label htmlFor="fund-book-from">Từ ngày</label>
          <input
            id="fund-book-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
          />
          <label htmlFor="fund-book-to">Đến ngày</label>
          <input
            id="fund-book-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
          />
          {(from || to) && (
            <button type="button" className="ops-fund-book__period-clear" onClick={() => { setFrom(''); setTo(''); }}>
              Xoá khoảng
            </button>
          )}
        </div>
      </header>
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
                // The running balance starts at the window's OPENING balance,
                // not zero: with a date window set, the rows below are the
                // window only, and a 0-based column would contradict the
                // "Số dư đầu kỳ" line printed under the same table. Without a
                // window the backend reports an opening of 0, so this is the
                // same number the old expression produced.
                const opening = Number(data?.periodOpening ?? 0);
                const running = opening + items.slice(0, index + 1).reduce((sum, entry) => sum + Number(entry.amount), 0);
                return (
                  <tr key={item.key} className="ops-wallet__row ops-wallet__row--fund-book">
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
      {data && windowed && (
        <section className="ops-fund-book__period-summary" aria-label="Tổng theo khoảng đang lọc" style={{ marginTop: 12, display: 'grid', gap: 4 }}>
          <strong>
            Khoảng đang lọc: {data.period.from ? formatDate(data.period.from) : 'đầu sổ'} — {data.period.to ? formatDate(data.period.to) : 'nay'}
          </strong>
          <span>Số dư đầu kỳ: <strong className="mono">{formatVnd(Number(data.periodOpening))} ₫</strong></span>
          <span>Thu trong kỳ: <strong className="mono">{formatVnd(Number(data.periodIn))} ₫</strong></span>
          <span>Chi trong kỳ: <strong className="mono">{formatVnd(Number(data.periodOut))} ₫</strong></span>
          <span>Số dư cuối kỳ: <strong className="mono">{formatVnd(Number(data.periodClosing))} ₫</strong></span>
          <span style={{ color: 'var(--text-muted, #6b7280)' }}>
            Các con số trên thuộc khoảng đang lọc. “Số dư cuối sổ” và “Còn phải hoàn ứng” bên dưới vẫn là số toàn thời gian.
          </span>
        </section>
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
