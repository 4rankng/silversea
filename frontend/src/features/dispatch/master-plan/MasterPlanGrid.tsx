import { useEffect, useRef, useState } from 'react';
import { useMasterPlanNoteEditor, type OperationalNoteSave } from './useMasterPlanNoteEditor';
import { FloatingCellEditor } from '../../../components/FloatingCellEditor';
import { isLclLotRow } from './lclLot';
import { canonicalShipmentStatus, ShipmentStatus } from '@tingting/shared';
import type { ShipmentListItem } from '../../../api/shipmentClient';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { NameCell } from '../../../components/shared/NameCell';
import {
  displayNote,
} from '../../shipments/cus/cusUtils';
import { formatDateTimeShort } from '../../../lib/format';
import { billBookingReference } from '../../../lib/business-reference';
import {
  isNoteLong,
  MasterPlanNoteModal,
  truncateNote,
  type ActiveNoteDetail,
} from './MasterPlanNoteModal';
import { MasterPlanCardList } from './MasterPlanCardList';
import { LclSelectCheckbox } from '../LclSelectCheckbox';
import '../LclSelectCheckbox.css';
import '../dispatch-row-menu.css';
import '../../../styles/operational-table-typography.css';
import './MasterPlanGrid.css';
import {
  aggregateContainerPortGroupLines,
  cargoCellLines,
  cutoffUrgency,
  formatCarrierAllocationChips,
  formatContainerSummaryLine,
  hasContainerDemand,
  scheduleBlocks,
} from './MasterPlanCellValues';

/* Owner redesign 23/10 — the pure per-row composers live in
 * MasterPlanCellValues (shared with MasterPlanCardList); this re-export keeps
 * the historical import surface (the XLSX export and the tests) unchanged. */
export {
  aggregateContainerPortGroupLines,
  cargoCellLines,
  cutoffUrgency,
  dayContainerSummary,
  formatContainerSummaryLines,
  scheduleBlocks,
} from './MasterPlanCellValues';
export type {
  CargoCellLine,
  ContainerPortGroupLine,
  ScheduleBlock,
} from './MasterPlanCellValues';

interface MasterPlanGridProps {
  items: ShipmentListItem[];
  onAllocate: (shipment: ShipmentListItem, trigger: HTMLButtonElement) => void;
  onViewContainers?: (shipment: ShipmentListItem, trigger: HTMLButtonElement) => void;
  /** FB-014: called when the dispatcher clicks a lot row (outside its
   *  controls) — the lot must open on /dispatch-detail (Kế hoạch Chi tiết)
   *  for full dispatch work, with the quick-view 'Chi tiết' trigger kept as
   *  the separate container peek. */
  onOpenDispatchDetail?: (shipment: ShipmentListItem) => void;
  /** Active single-day view (YYYY-MM-DD) — when set, each row's schedule
   *  lines show only that day's đóng/trả appointments. */
  scheduleDate?: string | null;
  /** Called when dispatch staff saves an inline operational-notes edit. */
  onUpdateNotes?: OperationalNoteSave;
  /** DISPATCHER scope: the backend accepts a dispatcher's write on intake-stage
   *  lots only (`assertDispatcherCanMutateShipmentIntake`), so for that role the
   *  note affordance is offered where the save can succeed and nowhere else. */
  notesIntakeOnly?: boolean;
  /** SPEC 18/10/2026 §2.1 — LCL multi-select feeding the "Gán xe nhóm" bar.
   *  When present, LCL rows get the leading checkbox column; FCL rows keep an
   *  empty cell. Grouped lots are refused until un-merged. */
  selectedLclShipmentIds?: ReadonlySet<number>;
  onToggleLclSelection?: (shipmentId: number, next: boolean) => void;
}

/** FB-014: a click anywhere on the row opens dispatch detail EXCEPT on the
 *  row's own controls — every interactive element (buttons, quick-view
 *  trigger, notes editor, LCL checkbox, the allocation action cell) keeps its
 *  own behavior. */
const ROW_CLICK_CONTROL_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[role="listbox"]',
  '[role="option"]',
  '.master-plan-grid__cell--action',
  '.master-plan-grid__cell--select',
  '.searchable-select',
].join(', ');

function rowClickHitsControl(target: HTMLElement) {
  return target.closest(ROW_CLICK_CONTROL_SELECTOR) != null;
}

/** Owner redesign 23/10 — the phone card list takes over below this
 *  CONTAINER width (measured on the grid's own wrapper, not the viewport:
 *  the workspace is the layout container at every zoom/sidebar state). Same
 *  law as the detailed-plan grid (CARD_MODE_BREAKPOINT = 640 there). */
const CARD_MODE_BREAKPOINT = 640;

/** Measures the wrapper's inline size and reports whether the card list
 *  owns the layout. jsdom (unit tests) has no ResizeObserver: the table is
 *  the default and card suites drive the card list directly. The anchor is
 *  a STATE callback ref, not a mount-time effect: the wrapper must re-bind
 *  when the layout mode flips its children.
 *
 *  Review M1 (this lane): the measurement rides borderBoxSize — a classic
 *  (Windows) scrollbar on the pane shrinks the CONTENT box ~15px, so a
 *  contentRect measurement at the 640px boundary flips table→cards (no
 *  scrollbar)→table… in a sustained loop. The border box keeps reporting
 *  the same width whether or not the pane's own scrollbar is drawn. */
function useCardLayoutMode(): [React.Dispatch<React.SetStateAction<HTMLDivElement | null>>, boolean] {
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  const [isCardMode, setIsCardMode] = useState(false);
  useEffect(() => {
    if (!anchorEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const width = entry?.borderBoxSize?.[0]?.inlineSize
        ?? entry?.contentRect.width ?? 0;
      const next = width < CARD_MODE_BREAKPOINT;
      setIsCardMode((current) => (current === next ? current : next));
    });
    observer.observe(anchorEl);
    return () => observer.disconnect();
  }, [anchorEl]);
  return [setAnchorEl, isCardMode];
}

/** The statuses a DISPATCHER may write (`assertDispatcherCanMutateShipmentIntake`). */
const DISPATCHER_INTAKE_STATUSES: Record<string, true> = {
  [ShipmentStatus.PENDING_DATE]: true,
  [ShipmentStatus.READY_FOR_DISPATCH]: true,
};

/**
 * Multi-line dispatch master-plan grid (docx §3): grouped columns with
 * distinct lift/drop port columns. Owner redesign 23/10 (QA R38): the
 * balanced table (min-width floor + horizontal rail) serves every canvas
 * ≥640px; below that the phone card list (`MasterPlanCardList`) takes over.
 * The allocation column exposes its values as the edit trigger, matching the
 * full-cell editing contract used by data grids.
 */
export function MasterPlanGrid({ items, onAllocate, onViewContainers = () => {}, onOpenDispatchDetail, scheduleDate, onUpdateNotes, notesIntakeOnly = false, selectedLclShipmentIds, onToggleLclSelection }: MasterPlanGridProps) {
  const [activeNoteModal, setActiveNoteModal] = useState<ActiveNoteDetail | null>(null);
  const [wrapperRef, isCardMode] = useCardLayoutMode();
  const {
    editingNotesId, editingNotesValue, setEditingNotesValue, savingNotes,
    notesError, notesInputRef, startNotesEdit, cancelNotesEdit, saveNotesEdit,
  } = useMasterPlanNoteEditor(onUpdateNotes);
  // SIL-631: the editing notes cell's stable anchor for the floating editor
  // host — one row edits at a time (editingNotesId), so one shared ref serves
  // every row's host.
  const notesAnchorRef = useRef<HTMLDivElement | null>(null);
  // The modal's "Sửa ghi chú" obeys the same dispatcher stage gate as the trigger.
  const noteModalShipment = activeNoteModal?.shipment;
  const noteModalEditable = Boolean(noteModalShipment && onUpdateNotes
    && (!notesIntakeOnly || DISPATCHER_INTAKE_STATUSES[noteModalShipment.status]));
  // The per-row gates, shared by the table columns and the phone card (one
  // law, one implementation — the card never re-derives them).
  const isAllocationLocked = (item: ShipmentListItem) => {
    // A lot's allocation is editable whenever the backend can accept the
    // save at all: `assignShipmentCarriers` refuses only intake phase (NEW /
    // PENDING_DATE) and CANCELED lots. Past READY the freeze is PER-CONTAINER
    // (card 354): trip-bound containers keep their carrier while unallocated
    // / untripped siblings accept fills — so DISPATCHED / IN_TRANSIT /
    // COMPLETED rows must stay editable, and the dialog's per-container guard
    // carries the precise "Không thể đổi nhà xe…" message when a change would
    // touch a container that already has an order.
    const canonical = canonicalShipmentStatus(item.status);
    return canonical == null
      || (canonical !== ShipmentStatus.READY_FOR_DISPATCH
        && canonical !== ShipmentStatus.DISPATCHED
        && canonical !== ShipmentStatus.IN_TRANSIT
        && canonical !== ShipmentStatus.COMPLETED);
  };
  const isNotesLocked = (item: ShipmentListItem) =>
    // Same stage rule as the note trigger: outside the intake window a
    // dispatcher's save is a 403, so the affordance is not offered there.
    !onUpdateNotes || (notesIntakeOnly && !DISPATCHER_INTAKE_STATUSES[item.status]);

  return (
    <div
      ref={wrapperRef}
      className={`master-plan-grid__wrapper${isCardMode ? ' master-plan-grid__wrapper--cards' : ''}`}
    >
      {isCardMode ? (
        <MasterPlanCardList
          items={items}
          scheduleDate={scheduleDate}
          onAllocate={onAllocate}
          onViewContainers={onViewContainers}
          onOpenDispatchDetail={onOpenDispatchDetail}
          onOpenNoteModal={setActiveNoteModal}
          isAllocationLocked={isAllocationLocked}
          isNotesLocked={isNotesLocked}
          notes={{
            editingNotesId, editingNotesValue, setEditingNotesValue, savingNotes,
            notesError, notesInputRef, startNotesEdit, cancelNotesEdit, saveNotesEdit,
          }}
          selectedLclShipmentIds={selectedLclShipmentIds}
          onToggleLclSelection={onToggleLclSelection}
        />
      ) : (
      <table className="master-plan-grid ops-table">
        <colgroup>
          {/* Spec 23/10 (261023110000 §2) — the CHỌN column is on-demand: it
              renders only while the page's [📦 Gộp hàng] mode is active
              (i.e. while it wires `onToggleLclSelection`); the default table
              reads full-width without it. */}
          {onToggleLclSelection && <col className="master-plan-grid__col master-plan-grid__col--select" />}
          <col className="master-plan-grid__col master-plan-grid__col--schedule" />
          <col className="master-plan-grid__col master-plan-grid__col--customer" />
          <col className="master-plan-grid__col master-plan-grid__col--route-shipping" />
          <col className="master-plan-grid__col master-plan-grid__col--lift-port" />
          <col className="master-plan-grid__col master-plan-grid__col--drop-port" />
          <col className="master-plan-grid__col master-plan-grid__col--cargo" />
          <col className="master-plan-grid__col master-plan-grid__col--allocation" />
          <col className="master-plan-grid__col master-plan-grid__col--notes" />
        </colgroup>
        <thead>
          <tr>
            {onToggleLclSelection && (
              <th scope="col" className="master-plan-grid__select-head">
                <span className="master-plan-grid__select-head-label">Chọn</span>
                <span className="sr-only"> lô</span>
              </th>
            )}
            <th scope="col"><span className="master-plan-grid__th-label">Thời gian &amp; lịch trình</span></th>
            <th scope="col"><span className="master-plan-grid__th-label">Khách hàng &amp; nhà máy</span></th>
            <th scope="col"><span className="master-plan-grid__th-label">Tuyến đường &amp; hãng tàu</span></th>
            <th scope="col"><span className="master-plan-grid__th-label">Cảng nâng</span></th>
            <th scope="col"><span className="master-plan-grid__th-label">Cảng hạ</span></th>
            <th scope="col"><span className="master-plan-grid__th-label">Tổng quan hàng hóa</span></th>
            <th scope="col"><span className="master-plan-grid__th-label">Phân bổ nhà xe</span></th>
            <th scope="col"><span className="master-plan-grid__th-label">Ghi chú</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const urgency = cutoffUrgency(item.customsCutoffAt);
            const portGroupLines = aggregateContainerPortGroupLines(item, scheduleDate);
            const allocationLocked = isAllocationLocked(item);
            const notesLocked = isNotesLocked(item);
            // FB-014: the whole row is the lot's open trigger when the parent
            // wires dispatch-detail navigation. Keyboard rides the row itself
            // (Enter/Space, UserTable convention) — every control inside keeps
            // its own key handling because the handler requires the row to be
            // the event target.
            const openableDetail = onOpenDispatchDetail != null;
            // Owner redesign 23/10 — the tooltip payloads: the cell bodies
            // clamp at the 93px row budget, so every fact that can ellipsize
            // carries its full value in a title (the sanctioned fallback).
            const scheduleTooltip = scheduleBlocks(item, scheduleDate)
              .map((block) => [block.head, block.sub].filter(Boolean).join(' · '))
              .join(' || ');
            const allocationChipsText = formatCarrierAllocationChips(item);
            return (
              <tr
                key={item.id}
                className={`master-plan-grid__row${openableDetail ? ' master-plan-grid__row--detail-link' : ''}`}
                tabIndex={openableDetail ? 0 : undefined}
                onClick={openableDetail ? (event) => {
                  if (rowClickHitsControl(event.target as HTMLElement)) return;
                  onOpenDispatchDetail(item);
                } : undefined}
                onKeyDown={openableDetail ? (event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onOpenDispatchDetail(item);
                } : undefined}
              >
                {onToggleLclSelection && (
                  <td className="master-plan-grid__cell master-plan-grid__cell--select" data-label="Chọn" data-label-short="Chọn">
                    <div className="master-plan-grid__cell-body">
                      {/* Spec 23/10 §2 — only LCL rows are tickable; FCL/cont
                          rows render dimmed so the operator cannot even try
                          to merge them (the merge is an LCL-only tool). */}
                      {isLclLotRow(item) ? (
                        <LclSelectCheckbox
                          isSelected={selectedLclShipmentIds?.has(item.id) ?? false}
                          isDisabled={item.costGroupId != null}
                          onToggle={(next: boolean) => onToggleLclSelection(item.id, next)}
                          ariaLabel={`Chọn lô ${billBookingReference(item.blNumber, item.bookingRef)}`}
                          title={item.costGroupId != null ? 'Lô đã thuộc nhóm ghép — tách nhóm trước khi ghép lại.' : 'Chọn lô này để gán xe nhóm'}
                        />
                      ) : (
                        <LclSelectCheckbox
                          isSelected={false}
                          isDisabled
                          onToggle={() => {}}
                          ariaLabel={`Lô ${billBookingReference(item.blNumber, item.bookingRef)} không tham gia gộp hàng`}
                          title="Chỉ ghép lô hàng lẻ (LCL) — lô cont không tích được."
                        />
                      )}
                    </div>
                  </td>
                )}
                <td className="master-plan-grid__cell" data-label="Thời gian & lịch trình" data-label-short="Giờ">
                  {/* Owner redesign 23/10: content-sized body (the FB-043
                      fixed-height tower is gone) — the cell's title carries
                      every clamped schedule fact. */}
                  <div className="master-plan-grid__cell-body" title={scheduleTooltip || undefined}>
                  {scheduleBlocks(item, scheduleDate).map((block, blockIdx) => (
                    <div className="master-plan-grid__schedule-block" key={`${item.id}-${blockIdx}`}>
                      {block.head && <div className="master-plan-grid__line">{block.head}</div>}
                      {block.sub && (
                        <div className="master-plan-grid__line master-plan-grid__line--muted master-plan-grid__line--sub">
                          {block.sub}
                        </div>
                      )}
                    </div>
                  ))}
                  {(item.containersMissingAppointment ?? 0) > 0 && (item.containerTotal ?? 0) > 0 && (
                    <div
                      className="master-plan-grid__line master-plan-grid__line--warning"
                      role="status"
                      title={`Cảnh báo: Còn ${item.containersMissingAppointment}/${item.containerTotal} cont chưa chốt ngày đóng trả`}
                    >
                      Cảnh báo: Còn {item.containersMissingAppointment}/{item.containerTotal} cont chưa chốt ngày đóng trả
                    </div>
                  )}
                  {item.customsCutoffAt && (
                    <div
                      className={`master-plan-grid__line${urgency === 'soon' ? ' master-plan-grid__line--soon' : ' master-plan-grid__line--urgent'}`}
                      title={`Hạn hoàn tất hải quan: ${formatDateTimeShort(item.customsCutoffAt)}`}
                    >
                      Hạn hoàn tất hải quan: {formatDateTimeShort(item.customsCutoffAt)}
                    </div>
                  )}
                  </div>
                </td>
                <td className="master-plan-grid__cell" data-label="Khách hàng & nhà máy" data-label-short="Khách">
                  <div className="master-plan-grid__cell-body">
                  <div className="master-plan-grid__line master-plan-grid__line--strong" data-empty={!item.customerName ? 'true' : undefined}>{item.customerName
                    ? <NameCell name={item.customerName} />
                    : '—'}</div>
                  <div
                    className="master-plan-grid__line"
                    data-empty={!(item.factoryNames?.length || item.factoryName) ? 'true' : undefined}
                    title={item.factoryNames && item.factoryNames.length > 0 ? item.factoryNames.join(' + ') : item.factoryName ?? undefined}
                  >{item.factoryNames && item.factoryNames.length > 0 ? item.factoryNames.join(' + ') : item.factoryName ?? '—'}</div>
                  <div
                    className="master-plan-grid__line master-plan-grid__line--strong"
                    data-empty={!(item.blNumber || item.bookingRef || item.isAdHoc) ? 'true' : undefined}
                    title={billBookingReference(item.blNumber, item.bookingRef) || undefined}
                  >
                    {item.blNumber || item.bookingRef || '—'}
                    {item.isAdHoc && <span className="adhoc-label" data-adhoc-label>Chạy ngoài</span>}
                  </div>
                  </div>
                </td>
                <td className="master-plan-grid__cell" data-label="Tuyến đường & hãng tàu" data-label-short="Tuyến">
                  <div className="master-plan-grid__cell-body">
                  <div className="master-plan-grid__route-shipping">
                    <div className="master-plan-grid__line master-plan-grid__line--strong master-plan-grid__route-shipping-route" data-empty={!item.routeName ? 'true' : undefined}>
                      {item.routeName ? <NameCell name={item.routeName} /> : '—'}
                    </div>
                    <div className="master-plan-grid__line master-plan-grid__line--strong master-plan-grid__route-shipping-direction" data-empty={!item.tradeDirection ? 'true' : undefined}>
                      {item.tradeDirection === 'IMPORT' ? (
                        <span>Nhập</span>
                      ) : item.tradeDirection === 'EXPORT' ? (
                        <span>Xuất</span>
                      ) : '—'}
                    </div>
                    <div
                      className="master-plan-grid__line master-plan-grid__line--strong master-plan-grid__route-shipping-carrier"
                      data-empty={!item.shippingLineName ? 'true' : undefined}
                      title={item.shippingLineName ?? undefined}
                    >{item.shippingLineName ?? '—'}</div>
                  </div>
                  </div>
                </td>
                <td className="master-plan-grid__cell master-plan-grid__cell--lift-port" data-label="Cảng nâng" data-label-short="Nâng">
                  <div className="master-plan-grid__cell-body">
                  {portGroupLines
                    .filter((line) => line.direction === 'lift')
                    .map((line, index) => (
                      <div key={`${index}-${line.portName}`} className="master-plan-grid__location-block">
                        <div className="master-plan-grid__line master-plan-grid__location-value" title={line.portName}>{line.portName}</div>
                        {line.containerSummary && (
                          <div
                            className="master-plan-grid__line master-plan-grid__location-value ops-container-line"
                            title={formatContainerSummaryLine(line.containerSummary)}
                          >
                            {formatContainerSummaryLine(line.containerSummary)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </td>
                <td className="master-plan-grid__cell master-plan-grid__cell--drop-port" data-label="Cảng hạ" data-label-short="Hạ">
                  <div className="master-plan-grid__cell-body">
                  {portGroupLines
                    .filter((line) => line.direction === 'drop')
                    .map((line, index) => (
                      <div key={`${index}-${line.portName}`} className="master-plan-grid__location-block">
                        <div className="master-plan-grid__line master-plan-grid__location-value" title={line.portName}>{line.portName}</div>
                        {line.containerSummary && (
                          <div
                            className="master-plan-grid__line master-plan-grid__location-value ops-container-line"
                            title={formatContainerSummaryLine(line.containerSummary)}
                          >
                            {formatContainerSummaryLine(line.containerSummary)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </td>
                <td className="master-plan-grid__cell" data-label="Tổng quan hàng hóa" data-label-short="Hàng">
                  <div className="master-plan-grid__cell-body">
                  <div className="master-plan-grid__cargo-content">
                    <div className="master-plan-grid__cargo-summary">
                      {/* Owner redesign 23/10 — "Container đủ 1 dòng": the
                          per-type demand joins onto ONE ellipsized line
                          (title carries the whole roster). */}
                      {(() => {
                        const lines = cargoCellLines(item, scheduleDate);
                        const demand = lines.filter((line) => !line.muted).map((line) => line.text).join(' + ');
                        const measures = lines.filter((line) => line.muted).map((line) => line.text).join(' · ');
                        const demandIdentity = lines.some((line) => !line.muted && line.identity);
                        return (
                          <>
                            <div
                              className={`master-plan-grid__line master-plan-grid__line--strong${demandIdentity ? ' ops-container-line' : ''}`}
                              data-empty={lines.filter((line) => !line.muted).every((line) => line.empty) ? 'true' : undefined}
                              title={demand || undefined}
                            >
                              {demand}
                            </div>
                            <div
                              className="master-plan-grid__line master-plan-grid__line--muted"
                              data-empty={lines.filter((line) => line.muted).every((line) => line.empty) ? 'true' : undefined}
                              title={measures || undefined}
                            >
                              {measures}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    {hasContainerDemand(item) && (
                      <UUIButton
                        size="xs"
                        color="link-color"
                        className="master-plan-grid__container-detail-trigger"
                        aria-label={`Xem chi tiết container của ${billBookingReference(item.blNumber, item.bookingRef)}`}
                        onPress={(event) => onViewContainers(item, (event.target as HTMLElement).closest('button') as HTMLButtonElement)}
                      >
                        Chi tiết
                      </UUIButton>
                    )}
                  </div>
                  </div>
                </td>
                <td
                  className="master-plan-grid__cell master-plan-grid__cell--action"
                  data-label="Phân bổ nhà xe"
                  data-label-short="Nhà xe"
                  onClick={(event) => {
                    if (allocationLocked) return;
                    if ((event.target as HTMLElement).closest('button')) return;
                    const trigger = event.currentTarget.querySelector<HTMLButtonElement>('.master-plan-grid__allocation-trigger');
                    if (!trigger) return;
                    trigger.focus();
                    onAllocate(item, trigger);
                  }}
                >
                  <div className="master-plan-grid__cell-body">
                  {/* Sweep (card 081026093510): the trigger used to disable
                      silently. It now rides the aria-described + aria-disabled
                      pattern (DisabledActionTip) so the lock reason is
                      reachable on hover AND keyboard focus — `isDisabled`/the
                      `disabled` attribute would take the button out of both. */}
                  <DisabledActionTip
                    id={`master-plan-allocation-${item.id}`}
                    reason={allocationLocked ? 'Lô chưa ở trạng thái có thể phân bổ nhà xe.' : null}
                  >
                    <UUIButton
                      size="sm"
                      color="tertiary"
                      noTextPadding
                      aria-label="Chỉnh sửa phân bổ nhà xe"
                      aria-disabled={allocationLocked || undefined}
                      className="master-plan-grid__allocation-trigger"
                      // The press target may be button's inner text span — resolve
                      // back to the button itself for focus restoration. The guard
                      // replaces the removed `isDisabled` click block.
                      onPress={(event) => {
                        if (allocationLocked) return;
                        onAllocate(item, (event.target as HTMLElement).closest('button') as HTMLButtonElement);
                      }}
                    >
                    <span className="master-plan-grid__allocation-label" aria-hidden="true">Phân bổ nhà xe</span>
                    {item.carrierAllocationSummary.length > 0 ? (
                      <span className="master-plan-grid__chips" title={allocationChipsText || undefined}>
                        {item.carrierAllocationSummary.map((entry) => {
                          const counts = [
                            entry.count20 > 0 ? `${entry.count20}x20'` : null,
                            entry.count40 > 0 ? `${entry.count40}x40'` : null,
                          ].filter(Boolean).join(' · ');
                          return (
                            <span
                              key={`${entry.carrierType}-${entry.externalCarrierId}`}
                              className="master-plan-grid__chip"
                            >
                              {counts ? `${entry.carrierLabel}: ${counts}` : entry.carrierLabel}
                            </span>
                          );
                        })}
                      </span>
                    ) : (
                      <span className="master-plan-grid__allocation-empty">Chưa phân bổ</span>
                    )}
                    </UUIButton>
                  </DisabledActionTip>
                  </div>
                </td>
                <td className="master-plan-grid__cell" data-label="Ghi chú" data-label-short="Ghi chú">
                  <div className="master-plan-grid__cell-body">
                  {editingNotesId === item.id && !notesLocked ? (
                    // SIL-631 (owner 28/10, GLOBAL): the notes editor floats
                    // OUTSIDE the Ghi chú cell through a body portal — the
                    // narrow notes column can no longer clip the textarea. The
                    // cell keeps its (dimmed) note while editing.
                    <div className="master-plan-grid__notes-editing" ref={notesAnchorRef}>
                      <div className="master-plan-grid__line master-plan-grid__line--notes is-editing">
                        {item.operationalNotes || '—'}
                      </div>
                      <FloatingCellEditor anchorRef={notesAnchorRef} label="Phiên sửa ghi chú điều phối" minWidth={360}>
                        <div className="master-plan-grid__notes-editor">
                      <textarea
                        ref={notesInputRef}
                        className="master-plan-grid__notes-input"
                        value={editingNotesValue}
                        disabled={savingNotes}
                        onChange={(e) => setEditingNotesValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            void saveNotesEdit(item);
                            return;
                          }
                          // Bare Enter falls through to the textarea's native
                          // newline so dispatch notes keep their line breaks.
                          if (e.key === 'Escape') cancelNotesEdit();
                        }}
                        rows={2}
                        maxLength={2000}
                        aria-label="Ghi chú điều phối"
                      />
                      {notesError && <p className="dispatch-plan-page__error" role="alert">{notesError}</p>}
                        <div className="master-plan-grid__notes-actions">
                          <button
                            type="button"
                            className="master-plan-grid__notes-save"
                            onClick={() => void saveNotesEdit(item)}
                            disabled={savingNotes}
                          >
                            {savingNotes ? 'Đang lưu…' : 'Lưu'}
                          </button>
                          {/* Sweep (card 081026093510): the cancel used to disable
                              silently while a save was in flight — same
                              aria-described + aria-disabled explanation. */}
                          <DisabledActionTip
                            id={`master-plan-notes-cancel-${item.id}`}
                            reason={savingNotes ? 'Đang lưu ghi chú — chưa hủy được.' : null}
                          >
                            <button
                              type="button"
                              className="master-plan-grid__notes-cancel"
                              aria-disabled={savingNotes || undefined}
                              onClick={() => { if (savingNotes) return; cancelNotesEdit(); }}
                            >
                              Hủy
                            </button>
                          </DisabledActionTip>
                        </div>
                        </div>
                      </FloatingCellEditor>
                    </div>
                  ) : (
                    <>
                      {(item.operationalNotes || (!notesLocked)) && (
                        <div className="master-plan-grid__line master-plan-grid__line--notes">
                          {!notesLocked ? (
                            <button
                              type="button"
                              className="master-plan-grid__notes-trigger"
                              title={item.operationalNotes ?? 'Nhấn để thêm ghi chú'}
                              aria-label="Chỉnh sửa ghi chú điều phối"
                              onClick={() => startNotesEdit(item)}
                            >
                              {item.operationalNotes
                                ? truncateNote(displayNote(item.operationalNotes))
                                : 'Thêm ghi chú'}
                            </button>
                          ) : (
                            <div title={item.operationalNotes ?? undefined}>{truncateNote(displayNote(item.operationalNotes))}</div>
                          )}
                          {item.operationalNotes && isNoteLong(item.operationalNotes) && (
                                <UUIButton
                                  size="xs"
                                  color="link-color"
                                  className="master-plan-grid__note-detail-trigger"
                                  aria-label="Xem chi tiết ghi chú điều hành"
                                  onPress={() => {
                                    setActiveNoteModal({
                                      title: 'Ghi chú điều hành',
                                      note: item.operationalNotes!,
                                      customerName: item.customerName,
                                      blNumber: item.blNumber,
                                      shipmentCode: item.shipmentCode,
                                      isOperational: true,
                                      shipment: item,
                                    });
                                  }}
                                >
                                  Xem thêm
                                </UUIButton>
                          )}
                        </div>
                      )}
                      {/* SIL-507 QA 27/10: the FB-014 row-click owns every bare
                          click on the row, so each note line carries its own
                          trigger — clicking OPS/NM text opens the shared note
                          modal (full text) and never the dispatch-detail
                          navigation. Buttons are already exempt from the
                          row-click control guard. */}
                      {item.opsRecoveryNotes?.map(note => (
                        <button
                          key={note}
                          type="button"
                          className="master-plan-grid__line master-plan-grid__line--notes master-plan-grid__notes-trigger"
                          title={note}
                          onClick={() => {
                            setActiveNoteModal({
                              title: 'Ghi chú OPS',
                              note,
                              customerName: item.customerName,
                              blNumber: item.blNumber,
                              shipmentCode: item.shipmentCode,
                              isOperational: false,
                              shipment: item,
                            });
                          }}
                        >
                          <strong>OPS: </strong>{note}
                        </button>
                      ))}
                      {item.factoryNotes && (
                        <div
                          className="master-plan-grid__line master-plan-grid__line--muted master-plan-grid__line--notes"
                          title={item.factoryNotes}
                        >
                          <button
                            type="button"
                            className="master-plan-grid__notes-trigger"
                            title={item.factoryNotes}
                            onClick={() => {
                              setActiveNoteModal({
                                title: 'Ghi chú nhà máy',
                                note: item.factoryNotes!,
                                customerName: item.customerName,
                                blNumber: item.blNumber,
                                shipmentCode: item.shipmentCode,
                                isOperational: false,
                                shipment: item,
                              });
                            }}
                          >
                            {`NM: ${isNoteLong(item.factoryNotes) ? truncateNote(item.factoryNotes) : item.factoryNotes}`}
                          </button>
                          {isNoteLong(item.factoryNotes) && (
                            <UUIButton
                              size="xs"
                              color="link-color"
                              className="master-plan-grid__note-detail-trigger"
                              aria-label="Xem chi tiết ghi chú nhà máy"
                              onPress={() => {
                                setActiveNoteModal({
                                  title: 'Ghi chú nhà máy',
                                  note: item.factoryNotes!,
                                  customerName: item.customerName,
                                  blNumber: item.blNumber,
                                  shipmentCode: item.shipmentCode,
                                  isOperational: false,
                                  shipment: item,
                                });
                              }}
                            >
                              Xem thêm
                            </UUIButton>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      )}

      <MasterPlanNoteModal
        activeNote={activeNoteModal}
        onClose={() => setActiveNoteModal(null)}
        onEditOperationalNote={noteModalEditable ? startNotesEdit : undefined}
      />
    </div>
  );
}
