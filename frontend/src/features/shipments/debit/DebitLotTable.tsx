import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronRight, Copy, Layers, MoreHorizontal, X } from 'lucide-react';
import { LCL_REV_MERGE_TAG } from '@tingting/shared';
import type { ShipmentDebitLotRow } from '../../../api/shipmentClient';
import { useToast } from '../../../components/shared/Toast';
import { DebitLotLclFacts } from './DebitLotLclFacts';
import { ShipmentDebitWorkspace } from './ShipmentDebitWorkspace';
import { UnmergeRevGroupAction } from './UnmergeRevGroupAction';
import {
  EMPTY_SUM_TOOLTIP, PENDING_TOOLTIP, ZERO_TOOLTIP,
  formatKnownMoney, lotDocuments, lotLabelOf, moneyState, sumMoneyStates, titleCaseName,
} from './debitMoney';

/**
 * DebitLotTable — the redesigned L1 settlement board (owner screenshots
 * 23/10 + spec v2 (a)/(b)/(e)).
 *
 * Shape: fixed-layout 11-column table inside a bounded scroll PANE so the
 * header (sticky top), the per-customer group header (sticky under it) and
 * the totals foot (sticky bottom) stay on screen — the same pane law the
 * dispatch grids landed (their 23/10 redesign). Rows are single-baseline
 * 52px; every money cell rides debitMoney's three states; row actions live
 * in the ⋯ kebab (audit #5: no more standalone black KHÓA LÔ HÀNG button).
 */

/** Sticky header height — the group header pins directly under it (CSS). */

type MoneyVariant = 'receivable' | 'carrier' | 'domestic' | 'payable' | 'profit';

function MoneyCell({ state, variant, note, tag, tagTitle }: { state: ReturnType<typeof moneyState>; variant: MoneyVariant; note?: string | null; tag?: string | null; tagTitle?: string | null }) {
  // SIL-546 — the REV-group member's visible merge tag («Ghép thu cước cùng
  // Lô 1») rides the receivable figure on its own truncating line (same
  // ellipsis + tooltip doctrine as every cell here). It replaces the icon
  // note on member rows: the tag's own title carries the full reason, and
  // one concept renders once per cell (design law §1).
  const tagNode = tag
    ? <span className="shipment-debit-money__mergetag" title={tagTitle ?? tag}>{tag}</span>
    : null;
  const cls = `shipment-debit-money shipment-debit-money--${variant}`;
  if (state.kind === 'pending') {
    // Owner 24/10: an undetermined figure reads as an EMPTY cell — the amber
    // 'Chờ số liệu' pill repeated ~5× per row across 170 lots and drowned the
    // real numbers. Known / zero / note keep their renders.
    return (
      <td className={cls} data-col={variant}>
        {note && <span className="shipment-debit-money__note" title={note} role="img" aria-label={`Ghi chú cước: ${note}`}><Layers size={12} aria-hidden="true" /></span>}
        {tagNode}
      </td>
    );
  }
  if (state.kind === 'zero') {
    return (
      <td className={cls} data-col={variant}>
        <span className="shipment-debit-money__zero" title={ZERO_TOOLTIP}>0</span>
        {note && <span className="shipment-debit-money__note" title={note} role="img" aria-label={`Ghi chú cước: ${note}`}><Layers size={12} aria-hidden="true" /></span>}
        {tagNode}
      </td>
    );
  }
  return (
    <td
      className={cls}
      data-col={variant}
      data-negative={variant === 'profit' && state.value < 0 ? '' : undefined}
    >
      {formatKnownMoney(state.value)}
      {note && <span className="shipment-debit-money__note" title={note} role="img" aria-label={`Ghi chú cước: ${note}`}><Layers size={12} aria-hidden="true" /></span>}
      {tagNode}
    </td>
  );
}

/** Sticky group subtotal cell — same three-state law, muted weight. */
function GroupSumCell({ state, col }: { state: ReturnType<typeof moneyState>; col: MoneyVariant }) {
  if (state.kind === 'pending') return <td className="shipment-debit-group__sum" data-col={col} title={PENDING_TOOLTIP}>—</td>;
  if (state.kind === 'zero') return <td className="shipment-debit-group__sum" data-col={col} title={ZERO_TOOLTIP}>0</td>;
  return <td className="shipment-debit-group__sum" data-col={col}>{formatKnownMoney(state.value)}</td>;
}

/** Foot total — bold tabular; nothing known yet reads '—' with its tooltip. */
function TotalCell({ value, col }: { value: number | null; col: MoneyVariant }) {
  if (value == null) return <td className="shipment-debit-totals__sum" data-col={col} title={EMPTY_SUM_TOOLTIP}>—</td>;
  return <td className="shipment-debit-totals__sum" data-col={col}>{formatKnownMoney(value)}</td>;
}

/** ── CHỨNG TỪ: one count badge; hover (300ms) or click opens the checklist. */
function DocsBadge({ row }: { row: ShipmentDebitLotRow }) {
  const docs = lotDocuments(row);
  const missing = docs.filter((doc) => !doc.ok).length;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
  }, []);

  const place = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - 236)) });
  };

  const openNow = () => {
    if (closeTimer.current != null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    place();
    setOpen(true);
  };

  const scheduleOpen = () => {
    if (open) return;
    hoverTimer.current = window.setTimeout(openNow, 300);
  };

  const scheduleClose = () => {
    if (hoverTimer.current != null) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    closeTimer.current = window.setTimeout(() => setOpen(false), 200);
  };

  const label = missing === 0 ? `${docs.length}/${docs.length}` : `Thiếu ${missing} C/T`;

  return (
    <span
      className="shipment-debit-docs"
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        ref={triggerRef}
        className={`shipment-debit-docs__badge${missing > 0 ? ' shipment-debit-docs__badge--missing' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={missing > 0 ? `Chứng từ (thiếu ${missing} / ${docs.length})` : `Chứng từ (đủ ${docs.length})`}
        // M1 review finding: without the stop the informational badge's click
        // bubbles to the row's select-alias and silently flips a pick.
        onClick={(event) => { event.stopPropagation(); if (open) setOpen(false); else openNow(); }}
      >
        {label}
      </button>
      {open && pos && createPortal(
        <div
          className="shipment-debit-docs__popover"
          role="dialog"
          aria-label={`Chứng từ lô ${lotLabelOf(row)}`}
          style={pos}
          onClick={(event) => event.stopPropagation()}
          onMouseEnter={() => { if (closeTimer.current != null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; } }}
          onMouseLeave={scheduleClose}
        >
          <p className="shipment-debit-docs__popover-title">Chứng từ ({docs.length})</p>
          <ul>
            {docs.map((doc, index) => (
              <li key={`${doc.label}-${index}`} className={doc.ok ? 'is-ok' : 'is-missing'}>
                {doc.ok ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
                <span className="shipment-debit-docs__kind">{doc.label}</span>
                <span className="shipment-debit-docs__value">{doc.ok && doc.value ? doc.value : 'Chưa đính kèm'}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </span>
  );
}

/** ── Tờ khai copy: one click lands the number in the OS clipboard. */
function CustomsCell({ row }: { row: ShipmentDebitLotRow }) {
  const { toast } = useToast();
  if (!row.customsNumber) return <td className="shipment-debit-cell--customs"><span className="shipment-debit-cell__empty">—</span></td>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(row.customsNumber!);
      toast({ kind: 'success', message: `Đã copy số tờ khai ${row.customsNumber}` });
    } catch {
      toast({ kind: 'error', message: 'Không copy được số tờ khai.' });
    }
  };
  return (
    <td className="shipment-debit-cell--customs">
      <span className="shipment-debit-cell--customs__wrap" title={row.customsNumber}>
        <span className="shipment-debit-cell--customs__value">{row.customsNumber}</span>
      </span>
      <button
        type="button"
        className="shipment-debit-copy"
        aria-label={`Copy số tờ khai ${row.customsNumber}`}
        onClick={(event) => { event.stopPropagation(); void copy(); }}
      >
        <Copy size={14} aria-hidden="true" />
      </button>
    </td>
  );
}

/**
 * SIL-538 — the merged row's merge tag + its direct Tách-nhóm popover.
 *
 * PRD 261023110000 §4.2: "Nút [Tách nhóm] trên dòng đã gộp" — CUS unmerges
 * straight from the row (click the Ghép (n/N) tag → popover holds the
 * action(s)), instead of digging through the ⋯ kebab. Same mounted-portal law
 * as DebitRowMenu: the list renders once and only hides on close, because the
 * UnmergeRevGroupAction owns live state (its ConfirmDialog + undo toast) that
 * unmounting would kill mid-interaction. One popover at a time shares the
 * kebab's process-wide closer (declared below, before DebitRowMenu).
 */
function MergedGroupTag({ row, onUnmerged }: {
  row: ShipmentDebitLotRow;
  onUnmerged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const myCloserRef = useRef<(() => void) | null>(null);
  const label = lotLabelOf(row);

  useEffect(() => () => {
    if (closeOpenDebitMenu === myCloserRef.current) closeOpenDebitMenu = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !listRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!open) {
      closeOpenDebitMenu?.();
      const closeSelf = () => setOpen(false);
      myCloserRef.current = closeSelf;
      closeOpenDebitMenu = closeSelf;
      if (rect) {
        setPos({ top: Math.min(rect.bottom + 4, window.innerHeight - 160), left: Math.max(8, Math.min(rect.left - 150, window.innerWidth - 208)) });
      }
    }
    setOpen((v) => !v);
  };

  const dimensions: Array<'REV' | 'COST'> = [];
  if (row.revGroupId != null) dimensions.push('REV');
  if (row.costGroupId != null) dimensions.push('COST');
  const groupLabel = `Ghép (${row.revGroupOrder ?? row.costGroupOrder ?? '?'}/${row.revGroupMemberCount ?? row.costGroupMemberCount ?? '?'})`;

  return (
    <span className="shipment-debit-mergetag" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="shipment-debit-mergetag__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Nhóm ghép của lô ${label} — mở tách nhóm`}
        title="Lô đã ghép — bấm để tách nhóm (Hủy ghép)"
        onClick={(event) => { event.stopPropagation(); toggle(); }}
      >
        {groupLabel}
      </button>
      {pos && createPortal(
        <div
          className={`shipment-debit-menu__list${open ? ' is-open' : ''}`}
          role="menu"
          aria-label={`Tách nhóm lô ${label}`}
          ref={listRef}
          style={pos}
          hidden={!open}
          onClick={(event) => event.stopPropagation()}
        >
          {dimensions.map((dimension) => (
            <div key={dimension} className="shipment-debit-menu__action">
              <UnmergeRevGroupAction
                id={`shipment-debit-mergetag-${dimension.toLowerCase()}-${row.shipmentId}`}
                groupId={dimension === 'REV' ? row.revGroupId! : row.costGroupId!}
                dimension={dimension}
                lotRef={label}
                disabledReason={row.lockStatus === 'LOCKED'
                  ? 'Nhóm ghép đã chốt kế toán — không thể tách nhóm.'
                  : null}
                onUnmerged={onUnmerged}
              />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
}


/** ── The ⋯ kebab: the row's ONE action affordance (owner redesign 23/10). */

/** One menu at a time, process-wide. A trigger's React stopPropagation (which
 *  keeps the row's select-alias quiet) also stops the NATIVE click from
 *  reaching the document listeners of an already-open menu — so menu↔menu
 *  exclusivity cannot ride outside-click. This registry does it directly:
 *  opening one menu closes whichever menu was open before it. */
let closeOpenDebitMenu: (() => void) | null = null;

function DebitRowMenu({ row, canManage, expanded, onToggle, onUnmerged }: {
  row: ShipmentDebitLotRow;
  canManage: boolean;
  expanded: boolean;
  onToggle: () => void;
  onUnmerged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const myCloserRef = useRef<(() => void) | null>(null);
  const label = lotLabelOf(row);

  // Unmounting (or navigating away) must not leave a stale closer registered.
  useEffect(() => () => {
    if (closeOpenDebitMenu === myCloserRef.current) closeOpenDebitMenu = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !listRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    // mousedown closes early in real interaction; click also catches
    // programmatic/synthetic clicks (tests) so two menus never coexist.
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!open) {
      closeOpenDebitMenu?.();
      const closeSelf = () => setOpen(false);
      myCloserRef.current = closeSelf;
      closeOpenDebitMenu = closeSelf;
      if (rect) {
        setPos({ top: Math.min(rect.bottom + 4, window.innerHeight - 180), left: Math.max(8, Math.min(rect.left - 150, window.innerWidth - 208)) });
      }
    }
    setOpen((v) => !v);
  };

  const closeAnd = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <span className="shipment-debit-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="shipment-debit-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Hành động lô ${label}`}
        onClick={(event) => { event.stopPropagation(); toggle(); }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {/* The list portals to body ONCE and stays mounted — closing only hides
          it — because the Tách nhóm entry owns live state (its ConfirmDialog
          + undo toast): unmounting on close would kill the confirm the same
          tick the item opens it. `display:none` keeps it out of the a11y tree
          and the tab order while closed. */}
      {pos && createPortal(
        <div
          className={`shipment-debit-menu__list${open ? ' is-open' : ''}`}
          role="menu"
          aria-label={`Hành động lô ${label}`}
          ref={listRef}
          style={pos}
          hidden={!open}
          // React portals propagate clicks through the React tree — without
          // this stop the item click would ALSO fire the row's select-alias
          // onClick (the portal's React parent IS the row).
          onClick={(event) => event.stopPropagation()}
        >
          {canManage && (
            <button type="button" role="menuitem" className="shipment-debit-menu__item" onClick={closeAnd(onToggle)}>
              {expanded ? `Đóng chi tiết lô ${label}` : `Mở chi tiết lô ${label}`}
            </button>
          )}
          {row.shipmentId && (
            <Link role="menuitem" className="shipment-debit-menu__item" to={`/shipments/${row.shipmentId}`} onClick={() => setOpen(false)}>
              Xem lô hàng
            </Link>
          )}
          {canManage && row.revGroupId != null && (
            <div className="shipment-debit-menu__action">
              <UnmergeRevGroupAction
                id={`shipment-debit-tach-nhom-${row.shipmentId}`}
                groupId={row.revGroupId}
                lotRef={label}
                disabledReason={row.lockStatus === 'LOCKED'
                  ? 'Nhóm ghép đã chốt kế toán — không thể tách nhóm.'
                  : null}
                onUnmerged={onUnmerged}
              />
            </div>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}

/** ── One lot row: single baseline, 52px, eleven fixed columns. */
function DebitLotRow({ row, canManage, mergeMode, expanded, onToggle, onSaved, onUnmerged, ratesRefreshing, selected, onSelect, plateOptions }: {
  row: ShipmentDebitLotRow;
  canManage: boolean;
  /** SIL-537/538 — CHỌN column rides the page's [📦 Gộp hàng] mode. */
  mergeMode: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
  onUnmerged: () => void;
  ratesRefreshing: boolean;
  selected: boolean;
  onSelect: (id: number, next: boolean) => void;
  /** FB-093: BKS combobox suggestions for the PHÂN XE quick edit. */
  plateOptions: Array<{ value: string; label: string; searchText?: string }>;
}) {
  const label = lotLabelOf(row);
  const laneText = row.factoryName || row.factoryAddress || '';
  const profitState = moneyState(row.profit);
  const receivableState = ratesRefreshing ? { kind: 'pending' as const } : moneyState(row.receivableTotal);
  // SIL-546 — a REV-group member (Lô 2..N: cước thu 0₫ vì nằm cùng Lô 1)
  // carries the spec's visible tag on its receivable cell; Lô 1 and ungrouped
  // rows never do. Same law the BE stamps on the dispatch summary
  // (revGroupOrder > 1 ⇒ LCL_REV_MERGE_TAG); tách nhóm clears the group ids
  // so the tag disappears with the group. The tag's tooltip keeps the full
  // F-2 reason; the icon note stays for non-member rows only. During the
  // post-tách refresh the whole cell goes silent (FB-145: the stale member
  // state must not repaint — money pending AND tag withheld until the fresh
  // board lands).
  const isRevMergeMember = row.revGroupId != null && (row.revGroupOrder ?? 1) > 1;
  const showRevMergeTag = isRevMergeMember && !ratesRefreshing;
  return (
    <>
      <tr
        className="shipment-debit-row"
        data-locked={row.lockStatus === 'LOCKED' ? '' : undefined}
        data-selected={selected || undefined}
        // SIL-537/538: the row itself is a select-alias ONLY in [📦 Gộp hàng]
        // mode — outside the mode a row click must never mutate an invisible
        // selection (the ticks are hidden there by design).
        onClick={() => { if (canManage && mergeMode) onSelect(row.shipmentId, !selected); }}
        title={canManage && mergeMode ? 'Chọn lô (gộp xe thu khách / xuất Debit Note)' : undefined}
      >
        {mergeMode && (
          <td className="shipment-debit-cell--select">
            {canManage ? (
              <input
                type="checkbox"
                className="shipment-debit-row__select"
                checked={selected}
                aria-label={`Chọn lô ${label}`}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onSelect(row.shipmentId, event.target.checked)}
              />
            ) : <span className="shipment-debit-cell__empty" aria-label="Chỉ xem tổng hợp">—</span>}
          </td>
        )}
        <td className="shipment-debit-cell--booking">
          <span className="shipment-debit-booking" title={label}>{label}</span>
        </td>
        <CustomsCell row={row} />
        <td className="shipment-debit-cell--lane">
          {laneText
            ? <span className="shipment-debit-lane" title={[row.factoryName, row.factoryAddress].filter(Boolean).join(' — ')}>{laneText}</span>
            : <span className="shipment-debit-cell__empty">—</span>}
        </td>
        <td className="shipment-debit-cell--docs"><DocsBadge row={row} /></td>
        <MoneyCell
          state={receivableState}
          variant="receivable"
          note={isRevMergeMember ? null : row.freightOverrideReason}
          tag={showRevMergeTag ? LCL_REV_MERGE_TAG : null}
          tagTitle={row.freightOverrideReason ?? LCL_REV_MERGE_TAG}
        />
        <MoneyCell state={moneyState(row.carrierCostTotal ?? null)} variant="carrier" />
        <MoneyCell state={moneyState(row.opsCostTotal ?? null)} variant="domestic" />
        <MoneyCell state={moneyState(row.payableTotal)} variant="payable" />
        <MoneyCell state={profitState} variant="profit" />
        <td className="shipment-debit-cell--status">
          <span className={`shipment-debit-status${row.lockStatus === 'LOCKED' ? ' shipment-debit-status--locked' : ''}`}>
            {row.lockStatus === 'LOCKED' ? 'Đã khóa' : 'Đang mở'}
          </span>
          {/* SIL-538 — the merged row's merge tag IS the direct surface: click
              opens a small popover hosting [Tách nhóm] (rev/cost) so CUS never
              has to dig the action out of the ⋯ kebab (PRD 261023110000 §4.2).
              The expanded drawer keeps its per-dimension Hủy ghép buttons. */}
          {canManage && (row.revGroupId != null || row.costGroupId != null) && (
            <MergedGroupTag row={row} onUnmerged={onUnmerged} />
          )}
          <DebitRowMenu row={row} canManage={canManage} expanded={expanded} onToggle={onToggle} onUnmerged={onUnmerged} />
        </td>
      </tr>
      {canManage && expanded && (
        <tr className="shipment-debit-expand">
          <td colSpan={mergeMode ? 11 : 10}>
            {row.cargoMode === 'LCL' && (
              <DebitLotLclFacts row={row} plateOptions={plateOptions} onChanged={onSaved} />
            )}
            <ShipmentDebitWorkspace shipmentId={row.shipmentId} customerId={row.customerId} locked={row.lockStatus === 'LOCKED'} onSaved={onSaved} />
          </td>
        </tr>
      )}
    </>
  );
}

interface LotGroup {
  key: string;
  customerId: number | null;
  name: string;
  rows: ShipmentDebitLotRow[];
}

/** Group by the row's OWN customer, in first-appearance order. */
function groupByCustomer(items: ShipmentDebitLotRow[]): LotGroup[] {
  const groups: LotGroup[] = [];
  const byKey = new Map<string, LotGroup>();
  for (const row of items) {
    const key = row.customerId == null ? 'none' : String(row.customerId);
    let group = byKey.get(key);
    if (!group) {
      group = { key, customerId: row.customerId, name: row.customerName ?? 'Khách chưa xác định', rows: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

function GroupHeader({ group, collapsed, onCollapse, leadingColSpan }: { group: LotGroup; collapsed: boolean; onCollapse: () => void; leadingColSpan: number }) {
  const displayName = titleCaseName(group.name) || group.name;  const sums = group.rows.map((row) => ({
    receivable: moneyState(row.receivableTotal),
    carrier: moneyState(row.carrierCostTotal ?? null),
    domestic: moneyState(row.opsCostTotal ?? null),
    payable: moneyState(row.payableTotal),
    profit: moneyState(row.profit),
  }));
  return (
    <tr className="shipment-debit-group">
      <td colSpan={leadingColSpan} className="shipment-debit-group__label">
        <button
          type="button"
          className="shipment-debit-group__chevron"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Mở' : 'Đóng'} nhóm khách hàng ${displayName}`}
          onClick={onCollapse}
        >
          {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
        <span className="shipment-debit-group__icon" aria-hidden="true"><Layers size={14} /></span>
        <span className="shipment-debit-group__name">{displayName}</span>
        <span className="shipment-debit-group__count">{`${group.rows.length} lô`}</span>
      </td>
      <GroupSumCell col="receivable" state={sumsToState(sums.map((s) => s.receivable))} />
      <GroupSumCell col="carrier" state={sumsToState(sums.map((s) => s.carrier))} />
      <GroupSumCell col="domestic" state={sumsToState(sums.map((s) => s.domestic))} />
      <GroupSumCell col="payable" state={sumsToState(sums.map((s) => s.payable))} />
      <GroupSumCell col="profit" state={sumsToState(sums.map((s) => s.profit))} />
      <td className="shipment-debit-group__tail" aria-hidden="true" />
    </tr>
  );
}

/** A pile of money states → one sum state (known values only). */
function sumsToState(states: Array<ReturnType<typeof moneyState>>): ReturnType<typeof moneyState> {
  const sum = sumMoneyStates(states);
  return sum == null ? { kind: 'pending' } : sum === 0 ? { kind: 'zero' } : { kind: 'known', value: sum };
}

export function DebitLotTable({ items, canManage, mergeMode, selectedIds, expandedId, onToggle, onSaved, onUnmerged, ratesRefreshing, plateOptions, onSelect }: {
  items: ShipmentDebitLotRow[];
  canManage: boolean;
  /** SIL-537/538 (PRD 261023110000 §2) — the CHỌN column is on-demand: it
   *  only renders while the page's [📦 Gộp hàng] mode stands; merged rows
   *  carry their direct Tách-nhóm tag popover in every mode. */
  mergeMode: boolean;
  selectedIds: Set<number>;
  expandedId: number | null;
  onToggle: (id: number) => void;
  onSaved: () => void;
  onUnmerged: () => void;
  ratesRefreshing: boolean;
  plateOptions: Array<{ value: string; label: string; searchText?: string }>;
  onSelect: (id: number, next: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = groupByCustomer(items);
  const toggleCollapse = (key: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const totalOf = (pick: (row: ShipmentDebitLotRow) => number | string | null | undefined) =>
    sumMoneyStates(items.map((row) => moneyState(pick(row))));

  return (
    <div className="shipment-debit-pane">
      <table className="shipment-debit-table">
        <thead>
          <tr>
            {mergeMode && <th scope="col" className="shipment-debit-col--select"><span className="sr-only">{canManage ? 'Chọn lô' : 'Chỉ xem'}</span></th>}
            <th scope="col" className="shipment-debit-col--booking">Mã lô / Booking</th>
            <th scope="col" className="shipment-debit-col--customs">Tờ khai</th>
            <th scope="col" className="shipment-debit-col--lane">Nhà máy / Tuyến</th>
            <th scope="col" className="shipment-debit-col--docs">Chứng từ</th>
            <th scope="col" className="shipment-debit-col--money shipment-debit-col--receivable">Doanh thu (₫)</th>
            <th scope="col" className="shipment-debit-col--money shipment-debit-col--carrier" title="Cước trả hãng vận chuyển">Cước trả (₫)</th>
            <th scope="col" className="shipment-debit-col--money shipment-debit-col--domestic">Chi nội địa (₫)</th>
            <th scope="col" className="shipment-debit-col--money shipment-debit-col--payable">Tổng chi (₫)</th>
            <th scope="col" className="shipment-debit-col--money shipment-debit-col--profit" title="Lợi nhuận gộp">LN gộp (₫)</th>
            <th scope="col" className="shipment-debit-col--status"><span className="sr-only">Trạng thái và hành động</span></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.key}>
              <GroupHeader group={group} collapsed={collapsed.has(group.key)} onCollapse={() => toggleCollapse(group.key)} leadingColSpan={mergeMode ? 5 : 4} />
              {!collapsed.has(group.key) && group.rows.map((row) => (
                <DebitLotRow
                  key={row.shipmentId}
                  row={row}
                  canManage={canManage}
                  mergeMode={mergeMode}
                  expanded={canManage && expandedId === row.shipmentId}
                  onToggle={() => onToggle(row.shipmentId)}
                  onSaved={onSaved}
                  onUnmerged={onUnmerged}
                  ratesRefreshing={ratesRefreshing}
                  selected={selectedIds.has(row.shipmentId)}
                  onSelect={onSelect}
                  plateOptions={plateOptions}
                />
              ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot className="shipment-debit-totals" data-testid="shipment-debit-totals">
          <tr>
            <td colSpan={mergeMode ? 5 : 4} className="shipment-debit-totals__label">{`Tổng cộng (${items.length} lô)`}</td>
            <TotalCell col="receivable" value={totalOf((row) => row.receivableTotal)} />
            <TotalCell col="carrier" value={totalOf((row) => row.carrierCostTotal ?? null)} />
            <TotalCell col="domestic" value={totalOf((row) => row.opsCostTotal ?? null)} />
            <TotalCell col="payable" value={totalOf((row) => row.payableTotal)} />
            <TotalCell col="profit" value={totalOf((row) => row.profit)} />
            <td className="shipment-debit-totals__tail" aria-hidden="true" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
