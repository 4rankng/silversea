// One workboard row (seven cell groups) for the CUS shipments page.
//
// Extracted verbatim from pages/ShipmentsPage.tsx in the 2026-09-01 structural
// split. Each editable cell is a full-cell trigger button so the inline editor
// opens from anywhere in the group; readonly cells keep the same layout via
// the non-button trigger wrapper.

import {
  SHIPMENT_STATUS_LABELS,
  ShipmentCusBucket,
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { DispatchIssueStatusSummaryChip } from '../../dispatch/components/DispatchIssueStatus';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { StatusStrip } from '../../../components/shared/StatusStrip';
import { WorkflowBadge } from './CusBadges';
import {
  aggregateContainerSummary,
  filterAppointmentGroupsByDate,
} from './cargoDayFilter';
import {
  appointmentGroupFactorySegment,
  derivePrimaryShipmentSignal,
  directionLabel,
  formatAppointmentGroupLine,
  formatQuantity,
  noteLines,
  scheduleTimestamp,
  SHIPMENT_BUCKET_COLORS,
  splitContainerSummaryLines,
  vehicleReadinessLabel,
  worksheetQuantity,
  type ShipmentQuickEditDraft,
} from './cusUtils';
import { formatDateTimeShort } from '../../../lib/format';
import type { LedgerColumn } from '../../../lib/column-visibility';

/**
 * The workboard's columns in table order (card 20260928_193). The row owns the
 * keys because the row owns the cells they name — the page reads this list to
 * build the `<colgroup>`, the header and the picker, so the three can never
 * disagree about what exists.
 *
 * `customer` (the row's identity, rendered as `th[scope=row]`) and `status` (the
 * row's ONLY action — `Chi tiết`) are pinned: hiding either costs the row its
 * context or its only way out (card 20260917_4 AC 3). `notes` declares the
 * auto-hide rule the source card asks for: hidden by default only while every
 * rendered row's note cell is empty.
 */
export const CUS_ROW_COLUMNS: readonly LedgerColumn[] = [
  { key: 'customer', label: 'Khách hàng & nhà máy', pinned: true },
  { key: 'documents', label: 'Chứng từ' },
  { key: 'classification', label: 'Phân loại & hãng tàu' },
  { key: 'cargo', label: 'Tổng quan hàng hóa' },
  { key: 'schedule', label: 'Lịch trình & điều xe' },
  { key: 'notes', label: 'Ghi chú', autoHideWhenEmpty: true },
  { key: 'status', label: 'Trạng thái', pinned: true },
];

export interface CusShipmentRowProps {
  item: ShipmentCusWorkspaceListItem;
  dateFrom: string;
  dateTo: string;
  /** A draft is open for this row's inline editor. */
  editing: boolean;
  /** Any draft is open — every other row's triggers disable while editing. */
  quickEditOpen: boolean;
  savingQuickEdit: boolean;
  /** Keys the picker is hiding (empty = render every cell). */
  hiddenColumns?: readonly string[];
  onStartQuickEdit: (item: ShipmentCusWorkspaceListItem, field: ShipmentQuickEditDraft['field']) => void;
  onOpenDetail: (shipmentId: number) => void;
}

export function CusShipmentRow({
  item, dateFrom, dateTo, editing, quickEditOpen, savingQuickEdit, hiddenColumns = [],
  onStartQuickEdit, onOpenDetail,
}: CusShipmentRowProps) {
  const isHidden = (key: string) => hiddenColumns.includes(key);
  const identity = item.billOrBookNumber || item.declarationNumber || item.customerName || 'lô hàng';
  // Card 20260921_3: the Chứng từ cell shows EVERY tờ khai of the lot, joined
  // exactly like the XLSX debit export; older wire payloads fall back to the
  // single number.
  const declarationNumbers = item.declarationNumbers ?? (item.declarationNumber ? [item.declarationNumber] : []);
  const primarySignal = derivePrimaryShipmentSignal(item, ['schedule']);
  const waitingSchedule = item.operational.scheduleReadiness === 'WAITING_DATE';
  const customerNoteLines = noteLines(item.customerNotes);
  const operationalNoteLines = noteLines(item.operationalNotes);
  const hasNotes = customerNoteLines.length > 0 || operationalNoteLines.length > 0;
  // Customer feedback L2 — when a date filter is active,
  // narrow the schedule + cargo cells to that day only.
  const filteredGroups = filterAppointmentGroupsByDate(
    item.appointmentGroups,
    dateFrom,
    dateTo,
  );
  const dayFilteredSummary = filteredGroups.length > 0
    ? aggregateContainerSummary(filteredGroups)
    : '';
  const hasDateFilter = Boolean(dateFrom || dateTo);
  const lotScheduleValue = scheduleTimestamp(item);

  // Law §1 (2026-09-22): a missing value is named once, not printed twice.
  // The cargo cell already says "Chưa có hàng hóa" for a lot that carries no
  // measurement at all, so the metric line underneath must not render a bare
  // "— kg" beside that name. One predicate drives both the density flag and
  // the suppression so the two cannot drift apart again.
  const cargoMetricsMissing = item.weightKg == null && (item.cargoMode !== 'LCL' || !item.volumeCbm);
  const groupsToShow = hasDateFilter ? filteredGroups : item.appointmentGroups;
  const scheduleContent = <>
    {waitingSchedule && <strong className="cus-schedule-missing">Chưa chốt ngày</strong>}
    {groupsToShow.map((group) => (
      <span key={`${group.at}-${group.factoryName ?? ''}`}>{formatAppointmentGroupLine(group.at, group.localDate)}{appointmentGroupFactorySegment(group.factoryName)} · {group.containerSummary}</span>
    ))}
    {/* Card 20260915_35 (lead ruling: fork a): the "Chỉnh sửa Lịch trình" dialog
        writes the SHIPMENT-level closingAt/plannedReturnAt, but for FCL lots the
        readiness rule counts only per-container appointments — so without this
        fallback the user's saved schedule never appears in the cell. Render the
        lot-level schedule whenever no appointment group is on display; the
        readiness chip above still warns while container appointments are open. */}
    {groupsToShow.length === 0 && lotScheduleValue && (
      <span key="lot-schedule-fallback" className="cus-schedule-lot-fallback">{formatDateTimeShort(lotScheduleValue)}</span>
    )}
    <span>{vehicleReadinessLabel(item)}</span>
    <DispatchIssueStatusSummaryChip
      plated={item.operational.plateAssignedContainers}
      issued={item.operational.orderIssuedContainers}
      total={item.operational.totalContainers}
    />
  </>;
  return (
    <tr
      key={item.id}
      className={`cus-dashboard-row${waitingSchedule ? ' cus-dashboard-row--waiting' : ''}`}
    >
      <th scope="row" data-label="Khách hàng & nhà máy" className="cus-dashboard-cell--editable cus-dashboard-cell--identity">
        <StatusStrip color={SHIPMENT_BUCKET_COLORS[item.bucket]} />
        <button id={`cus-inline-identity-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Khách hàng & nhà máy" data-cell-short="Khách hàng" disabled={(item.cargoMode !== 'FCL' && item.fieldAccess.factoryName.mode === 'READ_ONLY') || quickEditOpen || savingQuickEdit} title={item.cargoMode === 'FCL' ? 'Xem và chỉnh nhà máy theo từng container' : item.fieldAccess.factoryName.reason} onClick={() => onStartQuickEdit(item, 'identity')} aria-haspopup={item.cargoMode === 'FCL' ? undefined : 'dialog'} aria-label={`Sửa ô khách hàng và nhà máy ${identity}`}><span className="cus-multiline-cell">
          <strong className={`cus-customer-name${item.customerName ? '' : ' cus-empty'}`}>{item.customerName || '—'}{item.raw.isAdHoc && <span className="adhoc-label" data-adhoc-label>Chạy ngoài</span>}</strong>
          <span title={[...item.effectiveFactoryNames, item.factoryName].find(Boolean) || 'Chưa có nhà máy'} className={item.effectiveFactoryNames.length > 0 || item.factoryName ? undefined : 'cus-empty'}>{item.effectiveFactoryNames.length > 0
            ? item.effectiveFactoryNames.join(' + ')
            : item.factoryName || 'Chưa có nhà máy'}</span>
          <span title={item.routeName || item.deliveryLocation || 'Chưa có tuyến đường'} className={item.routeName || item.deliveryLocation ? undefined : 'cus-empty'}>{item.routeName || item.deliveryLocation || 'Chưa có tuyến đường'}</span>
        </span></button>
      </th>
      {!isHidden('documents') && (<td data-label="Chứng từ" className="cus-dashboard-cell--editable">
        <button id={`cus-inline-documents-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Chứng từ" disabled={item.fieldAccess.blNumber.mode === 'READ_ONLY' && item.fieldAccess.bookingRef.mode === 'READ_ONLY' && item.fieldAccess.declarationNumber.mode === 'READ_ONLY' || quickEditOpen || savingQuickEdit} title={item.fieldAccess.blNumber.reason} onClick={() => onStartQuickEdit(item, 'documents')} aria-haspopup="dialog" aria-label={`Sửa ô chứng từ ${identity}`}><span className="cus-multiline-cell cus-multiline-cell--mono">
          <strong className={item.billOrBookNumber ? undefined : 'cus-empty'}>{item.billOrBookNumber || 'Chưa có Bill/Book'}</strong>
          <span className={declarationNumbers.length > 0 ? undefined : 'cus-empty'}>{declarationNumbers.length > 0 ? declarationNumbers.join(', ') : 'Chưa có tờ khai'}</span>
        </span></button>
      </td>)}
      {!isHidden('classification') && (<td data-label="Phân loại & hãng tàu" className="cus-dashboard-cell--editable">
        <button id={`cus-inline-classification-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Phân loại & hãng tàu" data-cell-short="Phân loại" disabled={item.fieldAccess.tradeDirection.mode === 'READ_ONLY' && item.fieldAccess.shippingLineName.mode === 'READ_ONLY' || quickEditOpen || savingQuickEdit} title={item.fieldAccess.tradeDirection.reason} onClick={() => onStartQuickEdit(item, 'classification')} aria-haspopup="dialog" aria-label={`Sửa ô phân loại và hãng tàu ${identity}`}><span className="cus-multiline-cell cus-classification">
          <span className={item.shippingLineName ? 'cus-classification__shipping-line' : 'cus-classification__shipping-line cus-empty'}>{item.shippingLineName || 'Chưa có hãng tàu'}</span>
          {item.isCombined && <span className="cus-combined-tag">Đóng kết hợp</span>}
          {/* No direction yet means no badge at all: a filled pill holding a
              bare '—' was chrome (and a generic placeholder) inside a data
              cell — design law §1 (text-only cells, name the missing field). */}
          {item.direction && (
            <span className={`cus-direction-badge cus-direction-badge--${item.direction.toLowerCase()}`}>{directionLabel(item.direction)}</span>
          )}
        </span></button>
      </td>)}
      {!isHidden('cargo') && (<td data-label="Tổng quan hàng hóa" className="cus-dashboard-cell--editable">
        <button id={`cus-inline-cargo-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Tổng quan hàng hóa" data-cell-short="Hàng hóa" disabled={['packageCount', 'packageType', 'cargoWeightKg', 'cargoVolumeCbm'].every((key) => item.fieldAccess[key as 'packageCount'].mode === 'READ_ONLY') || quickEditOpen || savingQuickEdit} title={item.fieldAccess.packageCount.reason} onClick={() => onStartQuickEdit(item, 'cargo')} aria-haspopup="dialog" aria-label={`Sửa ô tổng quan hàng hóa ${identity}`}><span className="cus-multiline-cell cus-multiline-cell--numeric cus-cargo-summary">
          {(() => {
            // Customer feedback L2 — when a date filter is
            // active, show the per-day cont count instead of
            // the master lô totals.
            const summary = hasDateFilter ? dayFilteredSummary : item.containerSummary;
            const lines = splitContainerSummaryLines(summary);
            if (lines.length > 0) {
              return lines.map((summaryLine) => (
                <strong key={summaryLine} className="cus-cargo-summary__containers">{summaryLine}</strong>
              ));
            }
            if (hasDateFilter && !summary) {
              return <span className="cus-cargo-summary__containers cus-empty">Không có cont chạy ngày đã chọn</span>;
            }
            const quantity = worksheetQuantity(item);
            // Density + the text-only-cell law: when the card knows NOTHING about
            // the cargo, name the missing fact once instead of printing two em
            // dashes ("—" beside "— kg") on the dense fact row.
            if (quantity === '—' && item.cargoMode !== 'LCL' && item.weightKg == null) {
              return <span className="cus-cargo-summary__containers cus-empty">Chưa có hàng hóa</span>;
            }
            return <strong className="cus-cargo-summary__containers">{quantity}</strong>;
          })()}
          {!cargoMetricsMissing && (
            <span className="cus-cargo-summary__metrics">
              <span className="cus-cargo-summary__weight">
                {item.cargoMode === 'LCL'
                  ? `${formatQuantity(item.weightKg)} kg · ${item.volumeCbm ? `${formatQuantity(item.volumeCbm)} CBM` : '— CBM'}`
                  : `${formatQuantity(item.weightKg)} kg`}
              </span>
            </span>
          )}
        </span></button>
      </td>)}
      {!isHidden('schedule') && (<td data-label="Lịch trình & điều xe" className={item.cargoMode === 'LCL' ? 'cus-dashboard-cell--editable' : 'cus-dashboard-cell--readonly'}>
        {item.cargoMode === 'LCL' ? (
          <button
            id={`cus-inline-schedule-${item.id}`}
            type="button"
            className="cus-inline-trigger"
            data-cell-label="Lịch trình & điều xe"
            data-cell-short="Lịch trình"
            disabled={!item.operational.transportDateEditable || quickEditOpen || savingQuickEdit}
            aria-haspopup="dialog"
            aria-label={`Sửa ô lịch trình lô hàng ${identity}`}
            onClick={() => onStartQuickEdit(item, 'schedule')}
          >{scheduleContent}</button>
        ) : <div className="cus-inline-trigger cus-inline-trigger--readonly" data-cell-label="Lịch trình & điều xe" data-cell-short="Lịch trình">{scheduleContent}</div>}
      </td>)}
      {!isHidden('notes') && (<td data-label="Ghi chú" className={`cus-dashboard-cell--editable${hasNotes ? '' : ' cus-dashboard-cell--empty-notes'}`}>
        <button
          id={`cus-inline-notes-${item.id}`}
          type="button"
          className="cus-inline-trigger cus-note-preview"
          data-cell-label="Ghi chú"
          title={[item.customerNotes, item.operationalNotes].filter(Boolean).join('\n') || undefined}
          disabled={((item.fieldAccess.customerNotes.mode === 'READ_ONLY' && item.fieldAccess.operationalNotes.mode === 'READ_ONLY') || quickEditOpen || savingQuickEdit)}
          aria-haspopup="dialog"
          aria-label={`Sửa ô ghi chú lô hàng ${identity}`}
          onClick={() => onStartQuickEdit(item, 'notes')}
        >
          {/* User-ruled defect: note lines joined with ' - '/space rendered
              typed breaks away. Pre-wrap + 2-line clamp keeps the breaks. */}
          {customerNoteLines.length > 0 && <span className="cus-note-preview__customer cus-note-clamp">{customerNoteLines.join('\n')}</span>}
          {operationalNoteLines.length > 0 && <span className="cus-note-internal cus-note-clamp">{operationalNoteLines.join('\n')}</span>}
          {!hasNotes && <span className="cus-note-preview__customer cus-note-preview__customer--empty">Thêm ghi chú</span>}
        </button>
      </td>)}
      <td data-label="Trạng thái">
        <div className="cus-row-actions">
          {/* Card 20260924_21 (BATCH A, item 8): split the compound cell so the
              lifecycle state and the missing-data warning occupy SEPARATE
              slots per §1 "One concept, one place per row". The badge owns
              the status slot; the signal (when present) owns a dedicated
              slot beneath it. The detail-action buttons stay beside the
              status slot, visually attached to the badge they describe. */}
          <div className="cus-row-actions__status">
            <span className="cus-row-actions__lifecycle">
              <WorkflowBadge item={item} />
            </span>
            {primarySignal && (
              <span
                className={`cus-row-actions__signal cus-attention-label cus-attention-label--${primarySignal.tone}`}
                title={primarySignal.label}
              >
                {/* Card 20260922_27 (operator): TEXT ONLY in data cells — the
                    decorative icon is gone; the label carries the meaning. */}
                <span className="cus-attention-label__text">{primarySignal.label}</span>
              </span>
            )}
          </div>
          <div className="cus-row-actions__buttons">
            {/* Card 20260923_1 (operator ruling): the row's detail action is a
                text-only link button — no chevron, no trash, no pill chrome. */}
            <UUIButton
              id={'cus-dashboard-detail-' + item.id}
              size="sm"
              color="link-color"
              className="cus-dashboard-detail"
              aria-haspopup="dialog"
              aria-controls={'cus-detail-drawer-' + item.id}
              aria-label={'Mở chi tiết lô hàng ' + identity + ', trạng thái ' + (item.bucket === ShipmentCusBucket.NEW ? SHIPMENT_STATUS_LABELS[item.status] : item.bucketLabel)}
              onPress={() => onOpenDetail(item.id)}
              isDisabled={editing}
            >
              Chi tiết
            </UUIButton>
          </div>
        </div>
      </td>
    </tr>
  );
}
