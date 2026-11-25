import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Container as ContainerIcon, MoreHorizontal, PencilLine } from 'lucide-react';
import type { RefObject } from 'react';
import type { ShipmentListItem } from '../../../api/shipmentClient';
import { billBookingReference } from '../../../lib/business-reference';
import { formatDateTimeShort } from '../../../lib/format';
import { useDropdownDismiss } from '../../../hooks/useDropdownDismiss';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { FloatingCellEditor } from '../../../components/FloatingCellEditor';
import { LclSelectCheckbox } from '../LclSelectCheckbox';
import {
  aggregateContainerPortGroupLines,
  cargoCellLines,
  cutoffUrgency,
  formatCarrierAllocationChips,
  hasContainerDemand,
  scheduleBlocks,
  scheduleFactoryNames,
} from './MasterPlanCellValues';
import { isLclLotRow, lclLotFlag } from './lclLot';
import type { ActiveNoteDetail } from './MasterPlanNoteModal';
import './MasterPlanCardList.css';

/** Owner redesign 23/10 — the master-plan phone card list (<640px), following
 *  the DispatchPlanCardList pattern (commit 8a28c094): one card per lô.
 *  Owner mobile redesign 25/11 — the card reads as THREE clean rows, never
 *  five elements crammed into one: dòng 1 = the unified type badge (LCL chip
 *  / Cont pill, direction-hued) + the Bill/Booking code (nowrap, never broken
 *  mid-token) + the ⋯ menu at the right edge (quiet glyph, 30px, no chrome
 *  leak); dòng 2 = the customer name on ONE line (ellipsis when long) + the
 *  compact clock beside it (a repeated date never prints twice); thân = the
 *  Nâng → Trả route run and the cargo/status facts with the 32px "Phân bổ
 *  nhà xe" button at the right (HIDDEN once the lot carries a carrier roster
 *  — the Xe chips line reads instead). The note preview clamps to two lines
 *  with a 'Xem thêm' cue into the shared modal. The grid owns every piece of
 *  state — the card list only renders, so the table and the card can never
 *  fork in behaviour (notes editor, merge selection, allocation dialog
 *  wiring). FB-014 giữ nguyên: bấm card (ngoài control) mở Kế hoạch Chi
 *  tiết. Visual overrides for this sheet live in MasterPlanCardList.css —
 *  the pinned base rules stay in MasterPlanGrid.css (the contract suites
 *  read that file). */

/** The note-editor bundle the grid's `useMasterPlanNoteEditor` returns —
 *  forwarded verbatim so the card edits notes through the exact same flow. */
export interface MasterCardNoteEditorBundle {
  editingNotesId: number | null;
  editingNotesValue: string;
  setEditingNotesValue: (value: string) => void;
  savingNotes: boolean;
  notesError: string | null;
  notesInputRef: RefObject<HTMLTextAreaElement | null>;
  startNotesEdit: (shipment: ShipmentListItem) => void;
  cancelNotesEdit: () => void;
  saveNotesEdit: (shipment: ShipmentListItem) => void | Promise<void>;
}

export interface MasterPlanCardListProps {
  items: ShipmentListItem[];
  /** Active single-day view (YYYY-MM-DD) — narrows each row's lines to that
   *  day, the same narrowing the table serves. */
  scheduleDate?: string | null;
  onAllocate: (shipment: ShipmentListItem, trigger: HTMLButtonElement) => void;
  onViewContainers?: (shipment: ShipmentListItem, trigger: HTMLButtonElement) => void;
  /** FB-014 — a tap on the card (outside its controls) opens the lot on
   *  /dispatch-detail. */
  onOpenDispatchDetail?: (shipment: ShipmentListItem) => void;
  /** Opens the shared MasterPlanNoteModal (Xem ghi chú đầy đủ). */
  onOpenNoteModal: (detail: ActiveNoteDetail) => void;
  /** The grid's per-row gates, forwarded so the card serves the SAME laws the
   *  table column serves (never a second opinion): allocationLocked =
   *  assignShipmentCarriers would refuse the save; notesLocked = the
   *  dispatcher intake-stage gate. */
  isAllocationLocked: (shipment: ShipmentListItem) => boolean;
  isNotesLocked: (shipment: ShipmentListItem) => boolean;
  notes: MasterCardNoteEditorBundle;
  /** SPEC 18/10/2026 §2.1 — LCL multi-select feeding the "Gán xe nhóm" bar;
   *  present only while the page's [📦 Gộp hàng] mode is active. */
  selectedLclShipmentIds?: ReadonlySet<number>;
  onToggleLclSelection?: (shipmentId: number, next: boolean) => void;
}

/** FB-014 control guard — same selector family the table row uses: every
 *  interactive element inside the card keeps its own behavior. */
const CARD_CLICK_CONTROL_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="listbox"]',
  '[role="option"]',
  '.searchable-select',
].join(', ');

function cardClickHitsControl(target: HTMLElement) {
  return target.closest(CARD_CLICK_CONTROL_SELECTOR) != null;
}

/** Menu geometry — the DispatchRowActionsMenu contract: fixed-positioned at
 *  body level so no card/list clipping can hide the items. */
const MENU_WIDTH = 216;
const MENU_GAP = 6;
const VIEWPORT_PADDING = 8;
const MENU_ITEM_H = 38;

/** The card's single ⋯ menu — the row's secondary verbs (Chi tiết container,
 *  Sửa/Thêm ghi chú) in the shared dispatch-row-menu chrome. The primary
 *  verb (Phân bổ nhà xe) rides the card foot instead, per the dpcard
 *  one-primary-per-card law. */
function CardActionsMenu({ identity, hasContainers, notesEditable, noteLabel, onViewContainers, onEditNotes }: {
  identity: string;
  hasContainers: boolean;
  notesEditable: boolean;
  noteLabel: string;
  onViewContainers: (trigger: HTMLButtonElement) => void;
  onEditNotes: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null);
  useDropdownDismiss(open, () => setOpen(false));

  if (!hasContainers && !notesEditable) return null;

  const itemCount = (hasContainers ? 1 : 0) + (notesEditable ? 1 : 0);
  const menuHeight = itemCount * MENU_ITEM_H + 12;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const left = Math.max(VIEWPORT_PADDING, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING));
        const below = rect.bottom + MENU_GAP;
        const top = below + menuHeight > window.innerHeight - VIEWPORT_PADDING
          ? Math.max(VIEWPORT_PADDING, rect.top - MENU_GAP - menuHeight)
          : below;
        setPlacement({ top, left });
      }
    } else {
      setPlacement(null);
    }
  };

  const menu = open && placement && (
    <div
      className="dispatch-row-menu__list"
      role="menu"
      aria-label={`Thao tác lô · ${identity}`}
      data-dropdown-root=""
      style={{ position: 'fixed', top: placement.top, left: placement.left, width: MENU_WIDTH }}
    >
      {hasContainers && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            const trigger = triggerRef.current;
            if (trigger) onViewContainers(trigger);
          }}
        >
          <ContainerIcon size={14} aria-hidden="true" />
          Chi tiết container
        </button>
      )}
      {notesEditable && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onEditNotes();
          }}
        >
          <PencilLine size={14} aria-hidden="true" />
          {noteLabel}
        </button>
      )}
    </div>
  );

  return (
    <div className="dispatch-row-menu" data-dropdown-root={open ? '' : undefined}>
      <button
        ref={triggerRef}
        type="button"
        className="dispatch-row-menu__trigger"
        aria-label={`Thao tác lô · ${identity}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Thao tác · ${identity}`}
        onClick={toggle}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
}

/** Owner 25/11 — the note preview clamps to TWO lines with a visible
 *  'Xem thêm' cue; the button itself still opens the shared modal (the way
 *  back). The cue renders only when the text actually overflows the clamp —
 *  jsdom's zero-height box never overflows, so contract renders keep the
 *  exact accessible name. */
function NotePreviewButton({ text, onClick }: { text: string; onClick: () => void }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    // A line-clamp box reports its CLIPPED scrollHeight in Chrome, so
    // measure the full content height with the clamp lifted, then compare
    // against the clamped box height.
    const prevClamp = el.style.webkitLineClamp;
    el.style.webkitLineClamp = 'unset';
    const fullHeight = el.scrollHeight;
    el.style.webkitLineClamp = prevClamp;
    setTruncated(fullHeight > el.clientHeight + 1);
  }, [text]);
  return (
    <button
      type="button"
      className="mpcard__note"
      title="Bấm để xem toàn bộ ghi chú"
      onClick={onClick}
    >
      <span className="mpcard__note-text" ref={textRef}>{text}</span>
      {truncated && <span className="mpcard__note-more">Xem thêm</span>}
    </button>
  );
}

export function MasterPlanCardList({
  items,
  scheduleDate,
  onAllocate,
  onViewContainers = () => {},
  onOpenDispatchDetail,
  onOpenNoteModal,
  isAllocationLocked,
  isNotesLocked,
  notes,
  selectedLclShipmentIds,
  onToggleLclSelection,
}: MasterPlanCardListProps) {
  // SIL-631: the editing card's stable anchor for the floating editor host —
  // one card edits at a time (notes.editingNotesId), so one shared ref serves
  // every card's host (same law as the table surface).
  const notesAnchorRef = useRef<HTMLDivElement | null>(null);
  return (
    <ul className="mpcard-list" role="list">
      {items.map((item) => {
        const urgency = cutoffUrgency(item.customsCutoffAt);
        const portGroupLines = aggregateContainerPortGroupLines(item, scheduleDate);
        const liftRun = portGroupLines
          .filter((line) => line.direction === 'lift')
          .map((line) => line.portName)
          .join(' + ');
        const dropRun = portGroupLines
          .filter((line) => line.direction === 'drop')
          .map((line) => line.portName)
          .join(' + ');
        const isLcl = isLclLotRow(item);
        // Owner 25/11 — an LCL count with no package type names its unit on
        // the card ('5' → '5 kiện'); the shared composer keeps the bare count
        // (its contract pins do), so the card appends the default unit.
        const cargoLines = cargoCellLines(item, scheduleDate).map((line, index) => {
          if (isLcl && index === 0 && !line.empty && (item.packageType ?? '').trim() === '' && /^\d/.test(line.text)) {
            return { ...line, text: `${line.text} kiện` };
          }
          return line;
        });
        const cargoDemand = cargoLines.filter((line) => !line.muted && !line.empty).map((line) => line.text).join(' + ');
        const cargoMeasures = cargoLines.filter((line) => line.muted && !line.empty).map((line) => line.text).join(' · ');
        const reference = billBookingReference(item.blNumber, item.bookingRef);
        const typeDirection = item.tradeDirection === 'IMPORT' ? 'in' : item.tradeDirection === 'EXPORT' ? 'out' : 'na';
        const lclFlag = isLcl ? lclLotFlag(item) : null;
        // Same allocation-lock law as the table (assignShipmentCarriers refuses
        // intake-phase + CANCELED; past READY the freeze is per-container).
        const hasContainers = hasContainerDemand(item);
        const allocationChips = formatCarrierAllocationChips(item);
        const allocationLocked = isAllocationLocked(item);
        const notesLocked = isNotesLocked(item);
        const notesEditable = notes.editingNotesId !== item.id && !notesLocked;
        const openableDetail = onOpenDispatchDetail != null;
        // ── Card composers (owner 25/11 3-dòng layout) ──
        // Dòng 2 (giờ): the schedule heads — appointment instants or the
        // canonical fallback date/instant line, date-deduped — ride beside
        // the customer name so a busy lot never spends a whole row on its
        // clock.
        const scheduleHeads = scheduleBlocks(item, scheduleDate)
          .map((block) => block.head)
          .filter((head): head is string => Boolean(head));
        // Owner 25/11 — Row 2's clock: when the instant repeats the fallback
        // date, print the instant alone (never '20/11/2026 · 20/11/2026 10:00').
        const scheduleTime = scheduleHeads.length === 2
          && scheduleHeads[0] != null
          && scheduleHeads[1] != null
          && scheduleHeads[1].startsWith(`${scheduleHeads[0]} `)
          ? scheduleHeads[1]
          : scheduleHeads.join(' · ');
        // Thân — route: the Nâng/Trả run, the day's appointment factories,
        // tuyến and hãng tàu — WRAPS FULL (SIL-515: the card's body lines
        // render entirely on screen).
        const routeLine = [
          `Nâng ${liftRun || '—'} → Trả ${dropRun || '—'}`,
          ...scheduleFactoryNames(item, scheduleDate),
          item.routeName,
          item.shippingLineName,
        ].filter(Boolean).join(' · ');
        // Thân — facts: hàng hóa (identity weight, DIS-08) · đo lường · Xe
        // + the compact allocate button at the right. The button never spans
        // the row and hides once the roster exists (SIL-507).
        const fleetLine = allocationChips ? `Xe: ${allocationChips}` : 'Chưa phân xe';
        const showAllocate = !allocationLocked && !allocationChips;
        // Conditional status: the cont-booking warning and the customs cutoff
        // share ONE line (strongest severity wins the voice) so a busy lot
        // never grows past the divider-row budget.
        const warningText = (item.containersMissingAppointment ?? 0) > 0 && (item.containerTotal ?? 0) > 0
          ? `Còn ${item.containersMissingAppointment}/${item.containerTotal} cont chưa chốt ngày đóng trả`
          : null;
        const cutoffText = item.customsCutoffAt
          ? `Hải quan: ${formatDateTimeShort(item.customsCutoffAt)}`
          : null;
        const statusLine = [warningText, cutoffText].filter(Boolean).join(' · ');
        const statusSeverity = urgency === 'urgent' ? 'urgent' : warningText ? 'warning' : 'soon';
        // Notes collapse to ONE first-present line, and EVERY kind opens the
        // shared note modal (SIL-507 QA 27/10: the bare NM/OPS lines used to
        // fall through to the card's FB-014 detail navigation — the modal is
        // the designed behavior, navigation is not). The desktop table and
        // the container drawer still carry every note source in full.
        const notePreview: { text: string; detail: ActiveNoteDetail } | null = item.operationalNotes
          ? {
              text: `Ghi chú: ${item.operationalNotes.replace(/\n/g, ' ')}`,
              detail: { title: 'Ghi chú điều hành', note: item.operationalNotes, isOperational: true },
            }
          : item.factoryNotes
            ? {
                text: `NM: ${item.factoryNotes}`,
                detail: { title: 'Ghi chú nhà máy', note: item.factoryNotes, isOperational: false },
              }
            : item.opsRecoveryNotes?.[0]
              ? {
                  text: `OPS: ${item.opsRecoveryNotes[0]}`,
                  detail: { title: 'Ghi chú OPS', note: item.opsRecoveryNotes[0], isOperational: false },
                }
              : null;
        return (
          <li
            key={item.id}
            className={`mpcard${openableDetail ? ' mpcard--detail-link' : ''}${onToggleLclSelection && !isLclLotRow(item) ? ' mpcard--merge-dimmed' : ''}`}
            tabIndex={openableDetail ? 0 : undefined}
            onClick={openableDetail ? (event) => {
              if (cardClickHitsControl(event.target as HTMLElement)) return;
              onOpenDispatchDetail(item);
            } : undefined}
            onKeyDown={openableDetail ? (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onOpenDispatchDetail(item);
            } : undefined}
          >
            <div className="mpcard__head">
              {onToggleLclSelection && (isLclLotRow(item) ? (
                <LclSelectCheckbox
                  isSelected={selectedLclShipmentIds?.has(item.id) ?? false}
                  isDisabled={item.costGroupId != null}
                  onToggle={(next: boolean) => onToggleLclSelection(item.id, next)}
                  ariaLabel={`Chọn lô ${reference}`}
                  title={item.costGroupId != null ? 'Lô đã thuộc nhóm ghép — tách nhóm trước khi ghép lại.' : 'Chọn lô này để gán xe nhóm'}
                />
              ) : (
                /* Spec 23/10 §2 — FCL cards read the mode too, dimmed and
                   untouchable so the merge selection stays LCL-only. */
                <LclSelectCheckbox
                  isSelected={false}
                  isDisabled
                  onToggle={() => {}}
                  ariaLabel={`Lô ${reference} không tham gia gộp hàng`}
                  title="Chỉ ghép lô hàng lẻ (LCL) — lô cont không tích được."
                />
              ))}
              {/* Owner 25/11 — DÒNG 1: the unified type badge leads the row
                  (LCL rides the sanctioned chip recipe, Cont the same pill
                  shape in the direction hue), then the Bill/Booking code —
                  nowrap, never broken mid-token — and the ⋯ menu closes the
                  row at the right edge. */}
              <span
                className={lclFlag
                  ? 'mpcard__type'
                  : `mpcard__type mpcard__type--badge mpcard__type--${typeDirection}`}
              >
                {lclFlag ? (
                  <span
                    className={`master-plan-grid__lcl-chip${typeDirection === 'out' ? ' mpcard__lcl-chip--out' : ''}`}
                    title={lclFlag.title}
                  >
                    {lclFlag.label}
                  </span>
                ) : (
                  `${item.tradeDirection === 'IMPORT' ? 'Nhập' : item.tradeDirection === 'EXPORT' ? 'Xuất' : '—'} · Cont`
                )}
              </span>
              <span className="mpcard__bill" title={reference}>
                {reference}
                {item.isAdHoc && <span className="adhoc-label mpcard__adhoc" data-adhoc-label>Chạy ngoài</span>}
              </span>
              <CardActionsMenu
                identity={reference}
                hasContainers={hasContainers}
                notesEditable={notesEditable}
                noteLabel={item.operationalNotes ? 'Sửa ghi chú' : 'Thêm ghi chú'}
                onViewContainers={(trigger) => onViewContainers(item, trigger)}
                onEditNotes={() => notes.startNotesEdit(item)}
              />
            </div>
            {/* Owner 25/11 — DÒNG 2: the customer name on ONE line (ellipsis
                when long) and the compact clock beside it. */}
            <div className="mpcard__identity">
              <span className="mpcard__customer" title={item.customerName || undefined}>
                {item.customerName || '—'}
              </span>
              {scheduleTime && (
                <>
                  <span className="mpcard__dot" aria-hidden="true">·</span>
                  <span className="mpcard__time">{scheduleTime}</span>
                </>
              )}
            </div>
            <div className="mpcard__body">
              {/* Thân — route: Nâng → Trả · nhà máy ngày đó · tuyến · hãng
                  tàu, wrapping full (SIL-515 — the card's body cuts nothing). */}
              <div className="mpcard__route">{routeLine}</div>
              {/* Thân — meta: hàng hóa (identity weight, DIS-08) · đo lường
                  · Xe + the compact allocate button. The button never spans
                  the row and hides once the roster exists (SIL-507). */}
              <div className="mpcard__facts">
                {cargoDemand && (
                  <span className="mpcard__cargo ops-container-line">{cargoDemand}</span>
                )}
                {cargoMeasures && (
                  <span className="mpcard__measures">{cargoMeasures}</span>
                )}
                <span className="mpcard__fleet">{fleetLine}</span>
                {showAllocate && (
                  <button
                    type="button"
                    className="mpcard__allocate"
                    aria-label={`Phân bổ nhà xe · ${reference}`}
                    onClick={(event) => onAllocate(item, event.currentTarget)}
                  >
                    Phân bổ nhà xe
                  </button>
                )}
              </div>
              {/* Conditional status: warning + cutoff on ONE severity line. */}
              {statusLine && (
                <div
                  className={`mpcard__status mpcard__status--${statusSeverity}`}
                  role="status"
                >
                  {statusLine}
                </div>
              )}
              {notes.editingNotesId === item.id ? (
                // SIL-631 (owner 28/10, GLOBAL): same floating editor as the
                // table surface — the notes editor floats OUTSIDE the card
                // through a body portal; the card keeps its (dimmed) preview.
                <div className="master-plan-grid__notes-editing" ref={notesAnchorRef}>
                  <span className="mpcard__note is-editing">{notePreview?.text ?? 'Ghi chú'}</span>
                  <FloatingCellEditor anchorRef={notesAnchorRef} label="Phiên sửa ghi chú điều phối" minWidth={360}>
                    <div className="master-plan-grid__notes-editor">
                  <textarea
                    ref={notes.notesInputRef}
                    className="master-plan-grid__notes-input"
                    value={notes.editingNotesValue}
                    disabled={notes.savingNotes}
                    onChange={(e) => notes.setEditingNotesValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        void notes.saveNotesEdit(item);
                        return;
                      }
                      if (e.key === 'Escape') notes.cancelNotesEdit();
                    }}
                    rows={2}
                    maxLength={2000}
                    aria-label="Ghi chú điều phối"
                  />
                  {notes.notesError && <p className="dispatch-plan-page__error" role="alert">{notes.notesError}</p>}
                  <div className="master-plan-grid__notes-actions">
                    <button
                      type="button"
                      className="master-plan-grid__notes-save"
                      onClick={() => void notes.saveNotesEdit(item)}
                      disabled={notes.savingNotes}
                    >
                      {notes.savingNotes ? 'Đang lưu…' : 'Lưu'}
                    </button>
                    {/* Card 081026093510 sweep (review L1): the phone editor
                        carries the same aria-disabled + explained cancel the
                        table serves — the "Đang lưu…" lock reason stays
                        discoverable on touch too. */}
                    <DisabledActionTip
                      id={`master-card-notes-cancel-${item.id}`}
                      reason={notes.savingNotes ? 'Đang lưu ghi chú — chưa hủy được.' : null}
                    >
                      <button
                        type="button"
                        className="master-plan-grid__notes-cancel"
                        aria-disabled={notes.savingNotes || undefined}
                        onClick={() => { if (notes.savingNotes) return; notes.cancelNotesEdit(); }}
                      >
                        Hủy
                      </button>
                    </DisabledActionTip>
                  </div>
                    </div>
                  </FloatingCellEditor>
                </div>
              ) : (
                notePreview && (
                  <NotePreviewButton
                    text={notePreview.text}
                    onClick={() => onOpenNoteModal({
                      ...notePreview.detail,
                      customerName: item.customerName,
                      blNumber: item.blNumber,
                      shipmentCode: item.shipmentCode,
                      shipment: item,
                    })}
                  />
                )
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
