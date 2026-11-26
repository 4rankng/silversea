import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useClickOutside } from '../../hooks/useClickOutside';
import { usePopoverPosition } from '../../hooks/usePopoverPosition';
import { getShipmentDetail } from '../../api/shipmentClient';
import { qk } from '../../api/keys';
import { billBookingReference } from '../../lib/business-reference';
import {
  deriveDebitCloseReadiness,
  hasMissingCost,
  type DebitReadinessItem,
} from './debit-close-readiness';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import './DebitReadinessPopover.css';

/**
 * SIL-1096 (KB §3.1.3, K3.5 / K2.69) — the chot-debit row's answer to
 * "còn thiếu gì để lập bảng kê?": the four readiness conditions (hàng hóa ·
 * giá · chứng từ · điều kiện kỳ), each with its per-condition reason + cách
 * bổ sung; a satisfied condition renders a green tick (Đủ), never silence.
 *
 * The trigger REPLACES the bare "Thiếu chi phí" dot on rows that still miss
 * money fields (one concept, one place — the dot's silence was the QA
 * complaint). Mechanics are the house triple: `usePopoverPosition` +
 * `useClickOutside` + `createPortal`; Escape closes and focus returns to the
 * trigger; the lot's detail wire loads on demand (cached per lot in `qk`).
 */

function ReadyTick() {
  return <span className="debit-readiness__tick" role="img" aria-label="Đủ">✓</span>;
}

function ItemLine({ item }: { item: DebitReadinessItem }) {
  return (
    <li className={`debit-readiness__item ${item.ok ? 'debit-readiness__item--ok' : 'debit-readiness__item--missing'}`}>
      <span className="debit-readiness__label">{item.label}</span>
      {item.ok
        ? <ReadyTick />
        : (
          <span className="debit-readiness__answer">
            {item.reason != null && <span className="debit-readiness__reason">{item.reason}</span>}
            {item.howTo != null && <span className="debit-readiness__howto">Cách bổ sung: {item.howTo}</span>}
          </span>
        )}
    </li>
  );
}

/** The four-condition list, INSIDE the open panel: the lot's detail wire
 *  (documentSet Lớp 2, e-POD, freightRate trace ids) loads only while the
 *  popover is open, cached per lot in `qk`. Gated behind `open` so surfaces
 *  that render the column outside a QueryClientProvider (records views,
 *  tests) never mount the hook. */
function ReadinessList({ row }: { row: AccountingDebitBoardRow }) {
  const detailQuery = useQuery({
    queryKey: qk.shipmentDebitReadinessDetail(row.shipmentId),
    queryFn: () => getShipmentDetail(row.shipmentId),
    staleTime: 30_000,
  });
  const items = deriveDebitCloseReadiness(row, detailQuery.data);
  return (
    <ul className="debit-readiness__list">
      {items.map((item) => <ItemLine key={item.key} item={item} />)}
    </ul>
  );
}

export function DebitReadinessPopover({ row }: { row: AccountingDebitBoardRow }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lotRef = billBookingReference(row.billOrBooking) || row.code || `lô ${row.shipmentId}`;

  useClickOutside(panelRef, () => setOpen(false), {
    escapeKey: true,
    enabled: open,
    additionalRefs: [triggerRef],
    // onEscape REPLACES the dismissal in useClickOutside, so it must close
    // the panel itself and return focus to the trigger (KB affordance law).
    onEscape: () => {
      setOpen(false);
      triggerRef.current?.focus();
    },
  });
  const position = usePopoverPosition(panelRef, triggerRef, open, 320, 260);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="debit-readiness__trigger"
        aria-label={`Điều kiện lập bảng kê của ${lotRef} — xem còn thiếu gì`}
        aria-expanded={open}
        aria-haspopup="true"
        title={hasMissingCost(row)
          ? 'Thiếu chi phí — xem điều kiện lập bảng kê'
          : 'Điều kiện lập bảng kê — xem còn thiếu gì'}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {/* The dot keeps its KT8 meaning (red = the row still misses money
            fields); a complete row keeps a quiet neutral dot so the answer
            "còn thiếu gì" stays reachable on EVERY row (SIL-1096). The dot is
            decorative — the button label names the action. */}
        <span
          className={hasMissingCost(row) ? 'debit-cost-dot' : 'debit-cost-dot debit-readiness__dot-idle'}
          aria-hidden="true"
        />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="debit-readiness"
          role="dialog"
          aria-label={`Điều kiện lập bảng kê của ${lotRef}`}
          // "No coordinates means no position": the panel mounts hidden and
          // reveals only once usePopoverPosition has measured the trigger
          // (the house hook's own no-paint-before-measure law).
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            visibility: position != null ? 'visible' : 'hidden',
          }}
        >
          <div className="debit-readiness__head">
            <span className="debit-readiness__title">Điều kiện lập bảng kê</span>
            <button type="button" className="debit-readiness__close" aria-label="Đóng" onClick={close}>✕</button>
          </div>
          <ReadinessList row={row} />

        </div>,
        document.body,
      )}
    </>
  );
}
