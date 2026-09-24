import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { animate, spring, utils } from 'animejs';
import { useAnimatedOverlay, type EntranceFn, type ExitFn } from '../../hooks/useAnimatedOverlay';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { formatCurrency } from '../../lib/format';
import {
  type AccountingDebitBoardRow,
  type CreateSettlementRoundBody,
} from '../../api/accountingDebitClient';

// Card 20260923_12 — the Chọn Debit settlement popup (đợt chốt debit).
// One act = one đợt per (customer, lần, tháng, chiều thu/trả): the popup shows
// the applied date range, the user-chosen lần + tháng, ONE direction tick
// (phải thu from the customer / phải trả to the nhà xe) that reveals the
// counterparty + amount, VAT 0/5/8/10 with the auto-multiplied VAT amount and
// Tổng tiền = amount + VAT, and a ghi chú. Confirm issues the round (issue act,
// not a filter). White surface + body portal + focus trap per design law §3.
const entrance: EntranceFn = (overlay, content, prefersReduced) => {
  if (prefersReduced) {
    utils.set(overlay, { opacity: 1 });
    utils.set(content, { opacity: 1, scale: 1 });
    return;
  }
  utils.set(overlay, { opacity: 0 });
  animate(overlay, { opacity: [0, 1], duration: 180, ease: 'out(2)' });
  utils.set(content, { opacity: 0, scale: 0.92, willChange: 'opacity, transform' });
  animate(content, { opacity: [0, 1], scale: [0.92, 1], duration: 350, ease: spring({ stiffness: 320, damping: 22 }) });
};

const exit: ExitFn = (overlay, content, onDone) => {
  animate(overlay, { opacity: [1, 0], duration: 160, ease: 'in(2)' });
  animate(content, { opacity: [1, 0], scale: [1, 0.92], duration: 200, ease: 'in(3)', onComplete: onDone });
};

const VAT_RATES: Array<0 | 5 | 8 | 10> = [0, 5, 8, 10];

const fieldStyle: React.CSSProperties = { display: 'grid', gap: 4 };
const labelStyle: React.CSSProperties = { fontSize: 'var(--text-caption-size)', color: 'var(--text-muted, #64748b)' };

function monthOptions() {
  return Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `Tháng ${i + 1}` }));
}

function yearOptions() {
  const now = new Date().getFullYear();
  const years: number[] = [];
  for (let y = now - 3; y <= now + 1; y++) years.push(y);
  return years.map((y) => ({ value: y, label: String(y) }));
}

interface DebitSettlementRoundDialogProps {
  isOpen: boolean;
  rows: AccountingDebitBoardRow[];
  defaultDateFrom: string;
  defaultDateTo: string;
  serverError: string | null;
  onSubmit: (body: CreateSettlementRoundBody) => void;
  onClose: () => void;
  isPending: boolean;
}

export function DebitSettlementRoundDialog({ isOpen, rows, defaultDateFrom, defaultDateTo, serverError, onSubmit, onClose, isPending }: DebitSettlementRoundDialogProps) {
  // A server 400/409 must be readable INSIDE the popup — the page-level
  // status line sits behind the overlay while the dialog stays open.
  const errorLine = serverError;
  const portalTarget = typeof document === 'undefined' ? null : document.body;
  const overlayRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [roundNo, setRoundNo] = useState(1);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [direction, setDirection] = useState<'THU' | 'TRA' | null>(null);
  const [vatRate, setVatRate] = useState<0 | 5 | 8 | 10 | null>(null);
  const [ghiChu, setGhiChu] = useState('');

  // A freshly opened popup re-derives every field from the current selection —
  // never keeps the previous act's values.
  useEffect(() => {
    if (!isOpen) return;
    const dates = rows.map((r) => r.ngay).filter((v): v is string => v != null).sort();
    const fallbackFrom = defaultDateFrom || dates[0] || '';
    const fallbackTo = defaultDateTo || dates[dates.length - 1] || '';
    setDateFrom(fallbackFrom);
    setDateTo(fallbackTo);
    const parsedFrom = fallbackFrom ? Number(fallbackFrom.slice(0, 4)) : NaN;
    if (Number.isFinite(parsedFrom)) {
      setYear(parsedFrom);
      setMonth(Number(fallbackFrom.slice(5, 7)) || new Date().getMonth() + 1);
    }
    setDirection(null);
    setVatRate(null);
    setGhiChu('');
    setRoundNo(1);
  }, [isOpen, rows, defaultDateFrom, defaultDateTo]);

  const customerNames = useMemo(
    () => [...new Set(rows.map((r) => r.customerName).filter((v): v is string => v != null))],
    [rows],
  );
  const carrierLabels = useMemo(
    () => [...new Set(rows.flatMap((r) => r.phanXe))].sort(),
    [rows],
  );
  const carrierKeyCount = useMemo(
    () => new Set(rows.flatMap((r) => r.carrierKeys)).size,
    [rows],
  );
  const { baseAmount, amountKnown } = useMemo(() => {
    let sum = 0;
    let known = rows.length > 0;
    for (const row of rows) {
      const cell = direction === 'TRA' ? row.tra.tong1 : row.thu.tongThu;
      if (cell == null) { known = false; continue; }
      sum += Number(cell);
    }
    return { baseAmount: sum, amountKnown: known };
  }, [rows, direction]);

  const pairValid = customerNames.length === 1 && (direction !== 'TRA' || carrierKeyCount === 1);
  const canSubmit = pairValid && direction != null && vatRate != null
    && dateFrom !== '' && dateTo !== '' && dateFrom <= dateTo;
  const vatAmount = vatRate == null ? 0 : Math.round(baseAmount * vatRate) / 100;
  const totalAmount = baseAmount + vatAmount;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);
  const { visible, handleClose } = useAnimatedOverlay({ overlayRef, contentRef: boxRef, isOpen, onClose, entrance, exit });
  useFocusTrap(boxRef, visible && isOpen);
  if (!portalTarget) return null;

  const submit = () => {
    if (!canSubmit || direction == null || vatRate == null) return;
    onSubmit({
      shipmentIds: rows.map((r) => r.shipmentId),
      dateFrom, dateTo,
      roundNo,
      month, year,
      direction,
      vatRate,
      ghiChu: ghiChu.trim() || undefined,
    });
  };

  return createPortal(visible ? (
    <div ref={overlayRef} className="confirm-overlay" onClick={handleClose}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label="Chọn Debit — chốt đợt đối soát"
        className="confirm-box"
        style={{ width: 520, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto' }}
        onClick={(event) => event.stopPropagation()}
      >
        <p style={{ fontWeight: 600, margin: '0 0 10px' }}>Chọn Debit — chốt đợt đối soát ({rows.length} lô)</p>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={labelStyle}>Khách hàng</span>
            <span>{customerNames.length === 1 ? customerNames[0] : '— nhiều khách hàng trong lựa chọn —'}</span>
          </div>
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={labelStyle}>Nhà xe (từ phân xe của các lô)</span>
            <span>{carrierLabels.length > 0 ? carrierLabels.join(', ') : '—'}</span>
          </div>
          {customerNames.length !== 1 && (
            <p role="note" style={{ color: 'var(--err, #dc2626)', margin: 0 }}>Các lô đã chọn phải thuộc cùng một khách hàng.</p>
          )}
          {direction === 'TRA' && carrierKeyCount !== 1 && (
            <p role="note" style={{ color: 'var(--err, #dc2626)', margin: 0 }}>Chốt phải trả yêu cầu các lô cùng một nhà xe.</p>
          )}
          {errorLine && (
            <p role="note" style={{ color: 'var(--err, #dc2626)', margin: 0 }}>{errorLine}</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Từ ngày</span>
              <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Đến ngày</span>
              <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Lần</span>
              <select className="input" value={roundNo} onChange={(e) => setRoundNo(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Lần {i + 1}</option>)}
              </select>
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Tháng</span>
              <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {monthOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Năm</span>
              <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {yearOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            <legend style={labelStyle}>Chiều đối soát</legend>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="radio" name="dsr-direction" checked={direction === 'THU'} onChange={() => setDirection('THU')} />
              <span>Phải thu (từ khách hàng)</span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="radio" name="dsr-direction" checked={direction === 'TRA'} onChange={() => setDirection('TRA')} />
              <span>Phải trả (cho nhà xe)</span>
            </label>
          </fieldset>
          {direction != null && (
            <p style={{ margin: 0 }}>
              {direction === 'THU'
                ? <>Phải thu: <strong>{customerNames[0] ?? '—'}</strong></>
                : <>Phải trả: <strong>{carrierLabels.length === 1 ? carrierLabels[0] : '—'}</strong></>}
              {' — '}Số tiền: <strong>{amountKnown ? formatCurrency(baseAmount) : 'Chưa xác định'}</strong>
            </p>
          )}
          <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            <legend style={labelStyle}>VAT</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              {VAT_RATES.map((rate) => (
                <label key={rate} style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 44, minHeight: 44 }}>
                  <input type="radio" name="dsr-vat" checked={vatRate === rate} onChange={() => setVatRate(rate)} />
                  <span>{rate}%</span>
                </label>
              ))}
            </div>
            {direction != null && vatRate != null && (
              <p style={{ margin: 0 }}>
                Tiền VAT ({vatRate}%): <strong>{amountKnown ? formatCurrency(vatAmount) : 'Chưa xác định'}</strong>
                {' — '}Tổng tiền: <strong>{amountKnown ? formatCurrency(totalAmount) : 'Chưa xác định'}</strong>
              </p>
            )}
          </fieldset>
          <label style={fieldStyle}>
            <span style={labelStyle}>Ghi chú</span>
            <textarea className="input" rows={2} maxLength={500} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} placeholder="Ghi chú đợt chốt (tùy chọn)" />
          </label>
        </div>
        <div className="confirm-actions" style={{ marginTop: 14 }}>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>Hủy</button>
          <button type="button" className="btn btn--primary btn--sm" onClick={submit} disabled={!canSubmit || isPending}>
            {isPending ? 'Đang chốt…' : 'Chốt đợt'}
          </button>
        </div>
      </div>
    </div>
  ) : null, portalTarget);
}
