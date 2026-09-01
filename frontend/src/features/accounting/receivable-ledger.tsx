// Receivable ledger row + card for the AR side of the debt detail surface.
// Split from pages/DebtDetailPage.tsx in the 2026-09-01 structural wave (move-only).
import { formatDate } from '../../lib/format';
import { money, rowTypeLabel } from '../../pages/debt-detail-ledger';
import { TxnType } from '@tingting/shared';
import type { LedgerEntry } from '@tingting/shared';

export function receivablePill(txnType: TxnType): string {
  if (txnType === TxnType.PAYMENT_RECEIVED) return 'dd-txn-pill dd-txn-pill--pay';
  if (txnType === TxnType.TRIP_REVENUE) return 'dd-txn-pill dd-txn-pill--rev';
  if (txnType === TxnType.SERVICE_FEE) return 'dd-txn-pill dd-txn-pill--fee';
  if (txnType === TxnType.ADJUSTMENT || txnType === TxnType.UNLOCK_REVERSAL) {
    return 'dd-txn-pill dd-txn-pill--adj';
  }
  return 'dd-txn-pill dd-txn-pill--other';
}

export function ReceivableLedgerRow({ row }: { row: LedgerEntry }) {
  const debit = parseFloat(row.debit) || 0;
  const credit = parseFloat(row.credit) || 0;
  const balance = parseFloat(row.balance) || 0;
  const tripId = row.tripId ?? (
    row.txnType === TxnType.TRIP_REVENUE || row.txnType === TxnType.PAYMENT_RECEIVED
      ? row.txnId
      : null
  );
  const containers = row.containerNumbers?.filter(Boolean) ?? [];
  const primaryContent = row.routeName || row.serviceFeeLabel || row.note || 'Không có ghi chú';
  const secondaryContent = row.routeName && row.note && row.note !== row.routeName ? row.note : null;

  return (
    <tr>
      <td className="dd-td-date">{formatDate(row.timestamp)}</td>
      <td className="dd-reference">
        <strong>{row.tripCode || (tripId ? 'Chuyến chưa có mã' : row.receiptId || row.note || 'Giao dịch')}</strong>
        {containers.length > 0 && <small>Container {containers.join(', ')}</small>}
        {row.receiptId && tripId && <small>{row.receiptId}</small>}
      </td>
      <td className="dd-detail-content">
        <strong>{primaryContent}</strong>
        {secondaryContent && <small>{secondaryContent}</small>}
      </td>
      <td><span className={receivablePill(row.txnType)}>{rowTypeLabel(row)}</span></td>
      <td className={`dd-num ${debit > 0 ? 'dd-num--debit' : 'dd-num--dash'}`}>
        {debit > 0 ? money(debit) : '–'}
      </td>
      <td className={`dd-num ${credit > 0 ? 'dd-num--credit' : 'dd-num--dash'}`}>
        {credit > 0 ? money(credit) : '–'}
      </td>
      <td className={`dd-num ${balance > 0 ? 'dd-num--bal' : balance < 0 ? 'dd-num--credit' : ''}`}>
        {balance < 0 ? '-' : ''}{money(Math.abs(balance))}
      </td>
    </tr>
  );
}

export function ReceivableLedgerCard({ row }: { row: LedgerEntry }) {
  const debit = parseFloat(row.debit) || 0;
  const credit = parseFloat(row.credit) || 0;
  const balance = parseFloat(row.balance) || 0;
  const tripId = row.tripId ?? (
    row.txnType === TxnType.TRIP_REVENUE || row.txnType === TxnType.PAYMENT_RECEIVED
      ? row.txnId
      : null
  );
  const containers = row.containerNumbers?.filter(Boolean) ?? [];
  const reference = row.tripCode || (tripId ? 'Chuyến chưa có mã' : row.receiptId || row.note || 'Giao dịch');
  const detail = row.routeName || row.serviceFeeLabel || row.note || 'Không có ghi chú';
  const secondaryDetail = row.routeName && row.note && row.note !== row.routeName ? row.note : null;

  return (
    <li className="dd-ledger-mobile-card d-card d-card-border bg-base-100">
      <div className="dd-ledger-mobile-card__head">
        <time dateTime={row.timestamp}>{formatDate(row.timestamp)}</time>
        <span className={receivablePill(row.txnType)}>{rowTypeLabel(row)}</span>
      </div>
      <div className="dd-ledger-mobile-card__body">
        <strong>{reference}</strong>
        <p>{detail}</p>
        {secondaryDetail && <p>{secondaryDetail}</p>}
        {containers.length > 0 && <small>Container {containers.join(', ')}</small>}
        {row.receiptId && tripId && <small>{row.receiptId}</small>}
      </div>
      <dl className="dd-ledger-mobile-card__amounts">
        <div>
          <dt>Phải thu</dt>
          <dd>{debit > 0 ? money(debit) : '–'}</dd>
        </div>
        <div>
          <dt>Đã thu</dt>
          <dd className={credit > 0 ? 'text-success' : ''}>{credit > 0 ? money(credit) : '–'}</dd>
        </div>
        <div className="dd-ledger-mobile-card__balance">
          <dt>Số dư</dt>
          <dd className={balance > 0 ? 'text-error' : balance < 0 ? 'text-success' : ''}>
            {balance < 0 ? '-' : ''}{money(Math.abs(balance))}
          </dd>
        </div>
      </dl>
    </li>
  );
}


export function DualEntityLookupError({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="dd-ledger dd-ledger--standalone" style={{ marginBottom: 16 }}>
      <div className="dd-table-empty" role="alert">
        Không thể kiểm tra công nợ phải trả liên kết.{' '}
        <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
          Thử lại
        </button>
      </div>
    </section>
  );
}

// ── Ledger filter type ─────────────────────────────────────────────────────

/** Sort accessors for the AR ledger — the statement is a full-set, non-paginated
 * fetch, so column sorting happens client-side; the server's chronological
 * order stays until a header is used. Money accessors read the numeric value,
 * never the formatted string. */
