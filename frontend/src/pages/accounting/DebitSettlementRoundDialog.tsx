import { useEffect, useMemo, useRef, useState } from 'react';import { createPortal } from 'react-dom';
import { animate, spring, utils } from 'animejs';
import { useAnimatedOverlay, type EntranceFn, type ExitFn } from '../../hooks/useAnimatedOverlay';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { formatCurrency, formatDate } from '../../lib/format';
import { BufferedUuiDateInput } from '../../design-system/forms/BufferedUuiDateInput';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
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
// House token pass (card 191026100030, same rule cddf3315 applied to the page):
// `--text-muted` is not a defined variable anywhere in the app — its #64748b
// fallback WAS the rendered color, a stray hex off the ink scale. The house
// muted ink is `--ink-3`; `--err` is real (tokens.css) so its fallback dies too.
const labelStyle: React.CSSProperties = { fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)' };

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
  //
  // Card 191026160000 (§2d): the selection is grouped BY NGÀY and every date
  // carries its own tick (plus chọn/bỏ tất cả ngày). Only the ticked dates'
  // lots reach the round — kế toán closes theo ngày, not per whatever the
  // board selection happened to hold. All dates start ticked, so the previous
  // behavior (whole selection) remains the default. Seeded ONCE per open (the
  // ref guard): a board refetch while the dialog is open must not re-tick
  // dates the operator just excluded.
  const [tickedDates, setTickedDates] = useState<Set<string>>(new Set());
  const openedFor = useRef(false);
  const dateKeys = useMemo(
    () => [...new Set(rows.map((r) => r.ngay).filter((v): v is string => v != null))].sort(),
    [rows],
  );
  useEffect(() => {
    if (!isOpen) { openedFor.current = false; return; }
    if (openedFor.current) return;
    openedFor.current = true;
    setTickedDates(new Set(dateKeys));
    // The đợt's window seeds from the SELECTION's own span (min/max ticked
    // date at open); the page's month window is only the fallback. Card
    // 191026160000: the board now opens month-scoped, so letting the page
    // window win would date a cross-month selection wrongly.
    const dates = dateKeys;
    const fallbackFrom = dates[0] || defaultDateFrom || '';
    const fallbackTo = dates[dates.length - 1] || defaultDateTo || '';
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
    // dateKeys is derived from rows; see the ref guard above for why a change
    // while open does not re-seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const scopedRows = useMemo(
    () => rows.filter((row) => row.ngay != null && tickedDates.has(row.ngay)),
    [rows, tickedDates],
  );
  const allDatesTicked = dateKeys.length > 0 && tickedDates.size === dateKeys.length;
  const toggleDate = (date: string) => {
    setTickedDates((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      // The đợt's window follows the ticked span: a cross-month selection
      // narrowed by ticks must not file the lots under the stale month
      // (review F4 — periodKey drives the backend's duplicate-lần check).
      const span = [...next].sort();
      if (span.length > 0) {
        setDateFrom(span[0]!);
        setDateTo(span[span.length - 1]!);
        setYear(Number(span[0]!.slice(0, 4)));
        setMonth(Number(span[0]!.slice(5, 7)) || new Date().getMonth() + 1);
      }
      return next;
    });
  };
  const toggleAllDates = () => {
    const next = allDatesTicked ? new Set<string>() : new Set(dateKeys);
    setTickedDates(next);
    if (dateKeys.length > 0 && next.size > 0) {
      setDateFrom(dateKeys[0]!);
      setDateTo(dateKeys[dateKeys.length - 1]!);
      setYear(Number(dateKeys[0]!.slice(0, 4)));
      setMonth(Number(dateKeys[0]!.slice(5, 7)) || new Date().getMonth() + 1);
    }
  };

  const customerNames = useMemo(
    () => [...new Set(scopedRows.map((r) => r.customerName).filter((v): v is string => v != null))],
    [scopedRows],
  );
  const carrierLabels = useMemo(
    () => [...new Set(scopedRows.flatMap((r) => r.phanXe))].sort(),
    [scopedRows],
  );
  const carrierKeyCount = useMemo(
    () => new Set(scopedRows.flatMap((r) => r.carrierKeys)).size,
    [scopedRows],
  );
  const { baseAmount, amountKnown } = useMemo(() => {
    let sum = 0;
    let known = scopedRows.length > 0;
    for (const row of scopedRows) {
      const cell = direction === 'TRA' ? row.tra.tong1 : row.thu.tongThu;
      if (cell == null) { known = false; continue; }
      sum += Number(cell);
    }
    return { baseAmount: sum, amountKnown: known };
  }, [scopedRows, direction]);

  const pairValid = scopedRows.length > 0 && customerNames.length === 1 && (direction !== 'TRA' || carrierKeyCount === 1);
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
      // §2d: only the ticked dates' lots form the đợt.
      shipmentIds: scopedRows.map((r) => r.shipmentId),
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
        style={{ width: 520, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 48px)', overflowY: 'auto' }}
        onClick={(event) => event.stopPropagation()}
      >
        <p style={{ fontWeight: 600, margin: '0 0 10px' }}>Chọn Debit — chốt đợt đối soát ({scopedRows.length}/{rows.length} lô)</p>
        <div style={{ display: 'grid', gap: 12 }}>
          {/* §2d: mỗi ngày một ô tick — chọn/bỏ từng ngày vận chuyển hoặc cả
              nhóm, trước khi Chốt đợt. Chỉ các ngày được tick mới vào đợt. */}
          {dateKeys.length > 0 && (
            <fieldset style={{ border: '1px solid var(--border-1)', borderRadius: 8, margin: 0, padding: '8px 10px', display: 'grid', gap: 4 }}>
              <legend style={labelStyle}>Chọn ngày ({tickedDates.size}/{dateKeys.length} ngày · {scopedRows.length} lô)</legend>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={allDatesTicked}
                  onChange={toggleAllDates}
                  aria-label={allDatesTicked ? 'Bỏ chọn tất cả ngày' : 'Chọn tất cả ngày'}
                />
                <span>{allDatesTicked ? 'Bỏ chọn tất cả ngày' : 'Chọn tất cả ngày'}</span>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
                {dateKeys.map((date) => {
                  const lotsOfDay = rows.filter((row) => row.ngay === date).length;
                  return (
                    <label key={date} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={tickedDates.has(date)}
                        onChange={() => toggleDate(date)}
                        aria-label={`Chọn ngày ${date} (${lotsOfDay} lô)`}
                      />
                      <span>{formatDate(date)} <small style={{ color: 'var(--ink-3)' }}>({lotsOfDay} lô)</small></span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={labelStyle}>Khách hàng</span>
            <span>{customerNames.length === 1 ? customerNames[0] : '— nhiều khách hàng trong lựa chọn —'}</span>
          </div>
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={labelStyle}>Nhà xe (từ phân xe của các lô)</span>
            <span>{carrierLabels.length > 0 ? carrierLabels.join(', ') : '—'}</span>
          </div>
          {customerNames.length !== 1 && (
            <p role="note" style={{ color: 'var(--err)', margin: 0 }}>Các lô đã chọn phải thuộc cùng một khách hàng.</p>
          )}
          {direction === 'TRA' && carrierKeyCount !== 1 && (
            <p role="note" style={{ color: 'var(--err)', margin: 0 }}>Chốt phải trả yêu cầu các lô cùng một nhà xe.</p>
          )}
          {errorLine && (
            <p role="note" style={{ color: 'var(--err)', margin: 0 }}>{errorLine}</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <BufferedUuiDateInput label="Từ ngày" value={dateFrom} onChange={setDateFrom} />
            <BufferedUuiDateInput label="Đến ngày" value={dateTo} onChange={setDateTo} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <UuiSelectField
              label="Lần"
              size="md"
              value={String(roundNo)}
              onChange={(event) => setRoundNo(Number(event.target.value))}
              options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Lần ${i + 1}` }))}
            />
            <UuiSelectField
              label="Tháng"
              size="md"
              value={String(month)}
              onChange={(event) => setMonth(Number(event.target.value))}
              options={monthOptions().map((o) => ({ value: String(o.value), label: o.label }))}
            />
            <UuiSelectField
              label="Năm"
              size="md"
              value={String(year)}
              onChange={(event) => setYear(Number(event.target.value))}
              options={yearOptions().map((o) => ({ value: String(o.value), label: o.label }))}
            />
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
                <label key={rate} style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 'var(--control-touch-h)', minHeight: 'var(--control-touch-h)' }}>
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
