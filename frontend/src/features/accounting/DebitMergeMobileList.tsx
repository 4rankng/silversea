// UX-02 (staging UI audit 2026-11-27) — the ≤767px face of the Ghép bộ
// Debit board: the ~3.2kpx desktop grid is unreadable in a phone viewport
// (QA measured the table at 3,263px with only checkbox/date/bill visible),
// so the narrow band renders ONE CARD PER BILL instead — customer, amount,
// lock status and the selection checkbox readable with no horizontal
// scroll, and each card's fee breakdown one tap away in an expandable
// detail. The list is data-parallel, not state-parallel: it renders the
// SAME filtered rows the page hands the grid and shares the SAME
// selection Set + toggle callback, so batch selection, the "Đã chọn N lô"
// count and the toolbar money actions stay exact when the layout switches
// or filters change. The desktop grid (≥768px) is untouched.
import { useState } from 'react';
import type { DebitMergeItem } from '@tingting/shared';
import { formatMoney } from '../../lib/format';
import { PENDING_FEE_TIP } from './DebitMergeGrid';
import './DebitMergeMobileList.css';

export interface DebitMergeMobileListProps {
  rows: DebitMergeItem[];
  selection: ReadonlySet<number>;
  onSelectionChange: (shipmentId: number, next: boolean) => void;
}

/** Group-4 fee families — the same labels the grid's subs-row used, so a
 *  card's breakdown reads like the board it replaces. */
const CHI_HO_GROUPS: Array<{ key: 'csht' | 'lift' | 'drop' | 'other'; label: string }> = [
  { key: 'csht', label: 'Phí CSHT' },
  { key: 'lift', label: 'Phí nâng-cont / Lưu kho hàng lẻ' },
  { key: 'drop', label: 'Phí hạ-cont / Phí bốc xếp' },
  { key: 'other', label: 'Phí khác' },
];

const REVENUE_ROWS: Array<{ key: 'cuoc' | 'lachHuyen' | 'phuPhi' | 'phatSinh'; label: string }> = [
  { key: 'cuoc', label: 'Cước' },
  { key: 'lachHuyen', label: 'Lạch Huyện' },
  { key: 'phuPhi', label: 'Phụ phí' },
  { key: 'phatSinh', label: 'Phát sinh' },
];

interface CardFeeLine {
  key: string;
  label: string;
  value: string;
  pending: boolean;
}

/** The card's fee breakdown: the four cước-phải-thu leaves (the money law's
 *  '—' when unknown, never a fabricated 0), every invoiced chi-hộ fee line,
 *  and the two no-invoice Ops fee families. */
function cardFeeLines(row: DebitMergeItem): CardFeeLine[] {
  const lines: CardFeeLine[] = REVENUE_ROWS.map(({ key, label }) => ({
    key,
    label,
    value: formatMoney(row.revenue[key]),
    pending: false,
  }));
  for (const group of CHI_HO_GROUPS) {
    row.chiHo[group.key].forEach((fee, index) => {
      lines.push({
        key: `${group.key}-${index}`,
        label: fee.invoiceNumber ?? fee.feeName ?? '—',
        value: formatMoney(fee.amount),
        pending: fee.pending === true,
      });
    });
  }
  const noInvoice = row.noInvoice;
  if (noInvoice.gnFee != null) lines.push({ key: 'gn-fee', label: 'Phí GN OP TC', value: formatMoney(noInvoice.gnFee), pending: noInvoice.gnFeePending === true });
  if (noInvoice.gnPaid != null) lines.push({ key: 'gn-paid', label: 'Thực thu (GN OP TC)', value: formatMoney(noInvoice.gnPaid), pending: noInvoice.gnPaidPending === true });
  if (noInvoice.psFee != null) lines.push({ key: 'ps-fee', label: 'Phí PS OP TC', value: formatMoney(noInvoice.psFee), pending: noInvoice.psFeePending === true });
  if (noInvoice.psPaid != null) lines.push({ key: 'ps-paid', label: 'Thực thu (PS OP TC)', value: formatMoney(noInvoice.psPaid), pending: noInvoice.psPaidPending === true });
  noInvoice.fees.forEach((fee, index) => {
    lines.push({ key: `fee-${index}`, label: fee.name ?? '—', value: formatMoney(fee.amount), pending: fee.pending === true });
  });
  return lines;
}

function DebitMergeCard({
  row,
  selected,
  onSelectionChange,
}: {
  row: DebitMergeItem;
  selected: boolean;
  onSelectionChange: DebitMergeMobileListProps['onSelectionChange'];
}) {
  const [open, setOpen] = useState(false);
  // The lot label is the Số Bill/Booking — the internal SHP-* code never
  // reaches the screen (the same law the grid's Số HĐ column runs).
  const lotLabel = row.billOrBookNumber || `#${row.shipmentId}`;
  const locked = row.control.lockStatus === 'LOCKED';
  const detailId = `debit-merge-card-fees-${row.shipmentId}`;
  const fees = open ? cardFeeLines(row) : [];
  return (
    <article
      className={`debit-merge-card${selected ? ' debit-merge-card--selected' : ''}`}
      data-shipment-id={row.shipmentId}
      data-testid="debit-merge-card"
    >
      <label className="debit-merge-card__pick">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectionChange(row.shipmentId, event.target.checked)}
          aria-label={`Chọn lô ${lotLabel}`}
        />
      </label>
      <div className="debit-merge-card__body">
        <div className="debit-merge-card__head">
          <span className="debit-merge-card__bill">{lotLabel}</span>
          <span className={`debit-merge__lock-state${locked ? ' debit-merge__lock-state--locked' : ''}`}>
            {locked ? 'Đã khóa' : 'Mở'}
          </span>
        </div>
        <div className="debit-merge-card__customer">{row.customerName ?? '—'}</div>
        {/* QA 28/11 (P2 sweep): the big number rode naked — label it with the
            grid's own group-3 name (revenue.tong = the cước-phải-thu Tổng).
            The container numbers ride beneath so two 2-cont lots never read
            as the same card. */}
        <div className="debit-merge-card__amount-row">
          <span className="debit-merge-card__amount-label">Cước phải thu</span>
          <span className="debit-merge-card__amount">{formatMoney(row.revenue.tong)}</span>
        </div>
        {row.containers.length > 0 && (
          <div className="debit-merge-card__containers">
            {`${row.containers.length} cont: ${row.containers.map((container) => container.containerNumber).filter(Boolean).join(', ')}`}
          </div>
        )}
        <button
          type="button"
          className="debit-merge-card__expand"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Ẩn phí' : 'Phí chi tiết'}
        </button>
        {open && (fees.length > 0 ? (
          <dl id={detailId} className="debit-merge-card__fees">
            {fees.map((fee) => (
              <div className="debit-merge-card__fee" key={fee.key}>
                <dt className="debit-merge-card__fee-label">{fee.label}</dt>
                <dd
                  className={`debit-merge-card__fee-value${fee.pending ? ' debit-merge-card__fee-value--pending' : ''}`}
                  title={fee.pending ? PENDING_FEE_TIP : undefined}
                >
                  {fee.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p id={detailId} className="debit-merge-card__fees-empty">Không có khoản phí nào.</p>
        ))}
      </div>
    </article>
  );
}

export function DebitMergeMobileList({ rows, selection, onSelectionChange }: DebitMergeMobileListProps) {
  return (
    <section className="debit-merge-mobile" aria-label="Danh sách lô (bản di động)" data-testid="debit-merge-mobile-list">
      {rows.map((row) => (
        <DebitMergeCard
          key={row.shipmentId}
          row={row}
          selected={selection.has(row.shipmentId)}
          onSelectionChange={onSelectionChange}
        />
      ))}
      {rows.length === 0 && <p className="debit-merge-mobile__empty">Không có lô nào khớp bộ lọc hiện tại.</p>}
    </section>
  );
}

export default DebitMergeMobileList;
