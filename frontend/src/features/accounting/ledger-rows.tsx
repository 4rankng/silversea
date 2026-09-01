// Shared ledger row/card renderers for the payables + debt detail surfaces.
// Split from pages/PayableDetailPage.tsx in the 2026-09-01 structural wave (move-only).
import { formatCurrency, formatDate, formatNumber } from '../../lib/format';
import { TxnType } from '@tingting/shared';
import type { LedgerEntry } from '@tingting/shared';
export const TXN_META: Record<string, { label: string; pill: string }> = {
  [TxnType.VENDOR_EXPENSE]:  { label: 'Ghi nhận chi phí',   pill: 'dd-txn-pill dd-txn-pill--pen' },
  [TxnType.VENDOR_PAYMENT]:  { label: 'Thanh toán công nợ',  pill: 'dd-txn-pill dd-txn-pill--pay' },
  [TxnType.ADJUSTMENT]:      { label: 'Điều chỉnh',      pill: 'dd-txn-pill dd-txn-pill--adj' },
  [TxnType.FUEL_EXPENSE]:    { label: 'Chi phí nhiên liệu',  pill: 'dd-txn-pill dd-txn-pill--pen' },
  [TxnType.EXTERNAL_CARRIER_COST]: { label: 'Cước thuê ngoài', pill: 'dd-txn-pill dd-txn-pill--pen' },
  [TxnType.UNLOCK_REVERSAL]: { label: 'Hoàn tác',         pill: 'dd-txn-pill dd-txn-pill--adj' },
};
export const DEFAULT_META = { label: 'KHÁC', pill: 'dd-txn-pill dd-txn-pill--other' };

export function LedgerRow({ row }: { row: LedgerEntry }) {
  const debit = parseFloat(row.debit) || 0;
  const credit = parseFloat(row.credit) || 0;
  const balance = parseFloat(row.balance) || 0;
  const meta = TXN_META[row.txnType] ?? DEFAULT_META;
  const reference = row.receiptId
    || (row.txnType === TxnType.FUEL_EXPENSE ? row.tripCode || 'Chuyến chưa có mã' : null)
    || row.note
    || meta.label;

  return (
    <tr>
      <td className="dd-td-date">{formatDate(row.timestamp)}</td>
      <td className="dd-reference">
        <strong>{reference}</strong>
        {row.expenseDetails?.vehiclePlate && <small>{row.expenseDetails.vehiclePlate}</small>}
      </td>
      <td><span className={meta.pill}>{meta.label}</span></td>
      <td className={`dd-num ${credit > 0 ? 'dd-num--debit' : 'dd-num--dash'}`}>
        {credit > 0 ? formatCurrency(credit).replace(' ₫', '') + 'đ' : '–'}
      </td>
      <td className={`dd-num ${debit > 0 ? 'dd-num--credit' : 'dd-num--dash'}`}>
        {debit > 0 ? formatCurrency(debit).replace(' ₫', '') + 'đ' : '–'}
      </td>
      <td className={`dd-num ${balance > 0 ? 'dd-num--bal' : balance < 0 ? 'dd-num--credit' : ''}`}>
        {balance < 0 ? '-' : ''}{formatCurrency(Math.abs(balance)).replace(' ₫', '')}đ
      </td>
      <td className="dd-td-note">{row.note || ''}</td>
    </tr>
  );
}

export function FuelLedgerRow({ row }: { row: LedgerEntry }) {
  const detail = row.fuelDetails;
  const balance = parseFloat(row.balance) || 0;
  const amount = Number(detail?.amount ?? row.credit) || 0;
  const reference = row.tripCode || row.note || 'Chuyến chưa có mã';

  return (
    <tr className="dd-fuel-row">
      <td className="dd-td-date">{formatDate(detail?.departureDate ?? row.timestamp)}</td>
      <td className="dd-fuel-vehicle">{detail?.truckPlate || '—'}</td>
      <td className="dd-fuel-route">{detail?.routeName || '—'}</td>
      <td className="dd-num">{detail?.liters ? `${formatNumber(Number(detail.liters))} lít` : '—'}</td>
      <td className="dd-num">{detail?.unitPrice ? formatCurrency(Number(detail.unitPrice)) : '—'}</td>
      <td className="dd-num dd-num--debit">{formatCurrency(amount)}</td>
      <td className={`dd-num ${balance > 0 ? 'dd-num--bal' : balance < 0 ? 'dd-num--credit' : ''}`}>
        {balance < 0 ? '-' : ''}{formatCurrency(Math.abs(balance))}
      </td>
      <td className="dd-reference">
        <strong>{reference}</strong>
        {row.note && row.note !== reference && <small>{row.note}</small>}
      </td>
    </tr>
  );
}

export function ExpenseLedgerRow({ row }: { row: LedgerEntry }) {
  const detail = row.expenseDetails;
  const debit = parseFloat(row.debit) || 0;
  const credit = parseFloat(row.credit) || 0;
  const balance = parseFloat(row.balance) || 0;
  const reference = row.receiptId || row.note || detail?.categoryName || 'Chi phí nhà cung cấp';

  return (
    <tr className="dd-expense-row">
      <td className="dd-td-date">{formatDate(detail?.expenseDate ?? row.timestamp)}</td>
      <td className="dd-expense-vehicle">{detail?.vehiclePlate || '—'}</td>
      <td className="dd-expense-category">{detail?.categoryName || 'Ghi nhận chi phí'}</td>
      <td className="dd-reference"><strong>{reference}</strong></td>
      <td className={`dd-num ${credit > 0 ? 'dd-num--debit' : 'dd-num--dash'}`}>
        {credit > 0 ? formatCurrency(credit) : '–'}
      </td>
      <td className={`dd-num ${debit > 0 ? 'dd-num--credit' : 'dd-num--dash'}`}>
        {debit > 0 ? formatCurrency(debit) : '–'}
      </td>
      <td className={`dd-num ${balance > 0 ? 'dd-num--bal' : balance < 0 ? 'dd-num--credit' : ''}`}>
        {balance < 0 ? '-' : ''}{formatCurrency(Math.abs(balance))}
      </td>
      <td className="dd-td-note">{row.note || ''}</td>
    </tr>
  );
}

export function PayableLedgerCard({ row }: { row: LedgerEntry }) {
  const debit = parseFloat(row.debit) || 0;
  const credit = parseFloat(row.credit) || 0;
  const balance = parseFloat(row.balance) || 0;
  const meta = TXN_META[row.txnType] ?? DEFAULT_META;
  const reference = row.receiptId
    || (row.txnType === TxnType.FUEL_EXPENSE ? row.tripCode || 'Chuyến chưa có mã' : null)
    || row.note
    || meta.label;

  return (
    <li className="dd-ledger-mobile-card d-card d-card-border bg-base-100">
      <div className="dd-ledger-mobile-card__head">
        <time dateTime={row.timestamp}>{formatDate(row.timestamp)}</time>
        <span className={meta.pill}>{meta.label}</span>
      </div>
      <div className="dd-ledger-mobile-card__body">
        <strong>{reference}</strong>
        {row.note && row.note !== reference && <p>{row.note}</p>}
      </div>
      <dl className="dd-ledger-mobile-card__amounts">
        <div>
          <dt>Phải trả</dt>
          <dd>{credit > 0 ? formatCurrency(credit).replace(' ₫', '') + 'đ' : '–'}</dd>
        </div>
        <div>
          <dt>Đã trả</dt>
          <dd className={debit > 0 ? 'text-success' : ''}>{debit > 0 ? formatCurrency(debit).replace(' ₫', '') + 'đ' : '–'}</dd>
        </div>
        <div className="dd-ledger-mobile-card__balance">
          <dt>Số dư</dt>
          <dd className={balance > 0 ? 'text-error' : balance < 0 ? 'text-success' : ''}>
            {balance < 0 ? '-' : ''}{formatCurrency(Math.abs(balance)).replace(' ₫', '')}đ
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function FuelLedgerCard({ row }: { row: LedgerEntry }) {
  const detail = row.fuelDetails;
  const amount = Number(detail?.amount ?? row.credit) || 0;
  const reference = row.tripCode || row.note || 'Chuyến chưa có mã';

  return (
    <li className="dd-ledger-mobile-card dd-fuel-card d-card d-card-border bg-base-100">
      <div className="dd-ledger-mobile-card__head">
        <time dateTime={detail?.departureDate ?? row.timestamp}>
          {formatDate(detail?.departureDate ?? row.timestamp)}
        </time>
        <span className={TXN_META[TxnType.FUEL_EXPENSE].pill}>Chi phí nhiên liệu</span>
      </div>
      <div className="dd-ledger-mobile-card__body">
        <strong>{detail?.truckPlate || 'Chưa có biển số xe'}</strong>
        <p>{detail?.routeName || 'Chưa có tuyến vận chuyển'}</p>
        <small>{reference}</small>
      </div>
      <dl className="dd-ledger-mobile-card__amounts dd-fuel-card__amounts">
        <div>
          <dt>Số lít dầu</dt>
          <dd>{detail?.liters ? `${formatNumber(Number(detail.liters))} lít` : '—'}</dd>
        </div>
        <div>
          <dt>Đơn giá</dt>
          <dd>{detail?.unitPrice ? formatCurrency(Number(detail.unitPrice)) : '—'}</dd>
        </div>
        <div className="dd-ledger-mobile-card__balance">
          <dt>Thành tiền</dt>
          <dd>{formatCurrency(amount)}</dd>
        </div>
      </dl>
    </li>
  );
}

export function ExpenseLedgerCard({ row }: { row: LedgerEntry }) {
  const detail = row.expenseDetails;
  const credit = parseFloat(row.credit) || 0;
  const balance = parseFloat(row.balance) || 0;
  const reference = row.receiptId || row.note || detail?.categoryName || 'Chi phí nhà cung cấp';

  return (
    <li className="dd-ledger-mobile-card dd-expense-card d-card d-card-border bg-base-100">
      <div className="dd-ledger-mobile-card__head">
        <time dateTime={detail?.expenseDate ?? row.timestamp}>
          {formatDate(detail?.expenseDate ?? row.timestamp)}
        </time>
        <span className={TXN_META[TxnType.VENDOR_EXPENSE].pill}>Ghi nhận chi phí</span>
      </div>
      <div className="dd-ledger-mobile-card__body">
        <strong>{detail?.vehiclePlate || 'Chưa gắn biển số xe'}</strong>
        <p>{detail?.categoryName || reference}</p>
        {reference !== detail?.categoryName && <small>{reference}</small>}
      </div>
      <dl className="dd-ledger-mobile-card__amounts dd-expense-card__amounts">
        <div>
          <dt>Phải trả</dt>
          <dd>{credit > 0 ? formatCurrency(credit) : '–'}</dd>
        </div>
        <div className="dd-ledger-mobile-card__balance">
          <dt>Số dư</dt>
          <dd>{balance < 0 ? '-' : ''}{formatCurrency(Math.abs(balance))}</dd>
        </div>
      </dl>
    </li>
  );
}
