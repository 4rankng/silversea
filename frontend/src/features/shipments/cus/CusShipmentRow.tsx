// One workboard row (seven cell groups) for the CUS shipments page.
//
// Extracted verbatim from pages/ShipmentsPage.tsx in the 2026-09-01 structural
// split. Each editable cell is a full-cell trigger button so the inline editor
// opens from anywhere in the group; readonly cells keep the same layout via
// the non-button trigger wrapper.

import {
  ChevronRight,
  Trash2,
} from 'lucide-react';
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
  cargoModeLabel,
  derivePrimaryShipmentSignal,
  directionLabel,
  formatAppointmentGroupLine,
  formatQuantity,
  noteLines,
  SHIPMENT_BUCKET_COLORS,
  splitContainerSummaryLines,
  vehicleReadinessLabel,
  worksheetQuantity,
  type ShipmentQuickEditDraft,
} from './cusUtils';

export interface CusShipmentRowProps {
  item: ShipmentCusWorkspaceListItem;
  dateFrom: string;
  dateTo: string;
  /** A draft is open for this row's inline editor. */
  editing: boolean;
  /** Any draft is open — every other row's triggers disable while editing. */
  quickEditOpen: boolean;
  savingQuickEdit: boolean;
  pendingDelete: boolean;
  onStartQuickEdit: (item: ShipmentCusWorkspaceListItem, field: ShipmentQuickEditDraft['field']) => void;
  onOpenAction: (item: ShipmentCusWorkspaceListItem, mode: 'confirm' | 'lock' | 'reopen' | 'delete') => void;
  onOpenDetail: (shipmentId: number) => void;
}

export function CusShipmentRow({
  item, dateFrom, dateTo, editing, quickEditOpen, savingQuickEdit, pendingDelete,
  onStartQuickEdit, onOpenAction, onOpenDetail,
}: CusShipmentRowProps) {
  const identity = item.billOrBookNumber || item.declarationNumber || item.customerName || 'lô hàng';
  const primarySignal = derivePrimaryShipmentSignal(item);
  const PrimarySignalIcon = primarySignal?.icon;
  const waitingSchedule = item.operational.scheduleReadiness === 'WAITING_DATE';
  const customerNoteLines = noteLines(item.customerNotes);
  const operationalNoteLines = noteLines(item.operationalNotes);
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
  const scheduleContent = <>
    {waitingSchedule && <strong className="cus-schedule-missing">Chưa chốt ngày</strong>}
    {(hasDateFilter ? filteredGroups : item.appointmentGroups).map((group) => (
      <span key={group.at}>{formatAppointmentGroupLine(group.at, group.localDate)}{appointmentGroupFactorySegment(group.factoryName)} · {group.containerSummary}</span>
    ))}
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
        <button id={`cus-inline-identity-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Khách hàng & nhà máy" disabled={item.fieldAccess.factoryName.mode === 'READ_ONLY' || quickEditOpen || savingQuickEdit} title={item.fieldAccess.factoryName.reason} onClick={() => onStartQuickEdit(item, 'identity')} aria-haspopup="dialog" aria-label={`Sửa ô khách hàng và nhà máy ${identity}`}><span className="cus-multiline-cell">
          <strong className={`cus-customer-name${item.customerName ? '' : ' cus-empty'}`}>{item.customerName || '—'}</strong>
          <span className={item.effectiveFactoryNames.length > 0 || item.factoryName ? undefined : 'cus-empty'}>{item.effectiveFactoryNames.length > 0
            ? item.effectiveFactoryNames.join(' + ')
            : item.factoryName || 'Chưa có nhà máy'}</span>
          <span className={item.routeName || item.deliveryLocation ? undefined : 'cus-empty'}>{item.routeName || item.deliveryLocation || 'Chưa có tuyến đường'}</span>
        </span></button>
      </th>
      <td data-label="Chứng từ" className="cus-dashboard-cell--editable">
        <button id={`cus-inline-documents-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Chứng từ" disabled={item.fieldAccess.blNumber.mode === 'READ_ONLY' && item.fieldAccess.bookingRef.mode === 'READ_ONLY' && item.fieldAccess.declarationNumber.mode === 'READ_ONLY' || quickEditOpen || savingQuickEdit} title={item.fieldAccess.blNumber.reason} onClick={() => onStartQuickEdit(item, 'documents')} aria-haspopup="dialog" aria-label={`Sửa ô chứng từ ${identity}`}><span className="cus-multiline-cell cus-multiline-cell--mono">
          <strong className={item.billOrBookNumber ? undefined : 'cus-empty'}>{item.billOrBookNumber || 'Chưa có Bill/Book'}</strong>
          <span className={item.declarationNumber ? undefined : 'cus-empty'}>{item.declarationNumber || 'Chưa có tờ khai'}</span>
        </span></button>
      </td>
      <td data-label="Phân loại & hãng tàu" className="cus-dashboard-cell--editable">
        <button id={`cus-inline-classification-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Phân loại & hãng tàu" disabled={item.fieldAccess.tradeDirection.mode === 'READ_ONLY' && item.fieldAccess.shippingLineName.mode === 'READ_ONLY' || quickEditOpen || savingQuickEdit} title={item.fieldAccess.tradeDirection.reason} onClick={() => onStartQuickEdit(item, 'classification')} aria-haspopup="dialog" aria-label={`Sửa ô phân loại và hãng tàu ${identity}`}><span className="cus-multiline-cell cus-classification">
          <span className={item.shippingLineName ? 'cus-classification__shipping-line' : 'cus-classification__shipping-line cus-empty'}>{item.shippingLineName || 'Chưa có hãng tàu'}</span>
          {item.isCombined && <span className="cus-combined-tag">Đóng kết hợp</span>}
          <span className={`cus-direction-badge cus-direction-badge--${item.direction?.toLowerCase() || 'unknown'}`}>{directionLabel(item.direction)}</span>
        </span></button>
      </td>
      <td data-label="Tổng quan hàng hóa" className="cus-dashboard-cell--editable">
        <button id={`cus-inline-cargo-${item.id}`} type="button" className="cus-inline-trigger" data-cell-label="Tổng quan hàng hóa" disabled={['packageCount', 'packageType', 'cargoWeightKg', 'cargoVolumeCbm'].every((key) => item.fieldAccess[key as 'packageCount'].mode === 'READ_ONLY') || quickEditOpen || savingQuickEdit} title={item.fieldAccess.packageCount.reason} onClick={() => onStartQuickEdit(item, 'cargo')} aria-haspopup="dialog" aria-label={`Sửa ô tổng quan hàng hóa ${identity}`}><span className="cus-multiline-cell cus-multiline-cell--numeric cus-cargo-summary">
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
            return <strong className="cus-cargo-summary__containers">{worksheetQuantity(item)}</strong>;
          })()}
          <span className={item.weightKg == null && (item.cargoMode !== 'LCL' || !item.volumeCbm) ? 'cus-cargo-summary__metrics cus-empty' : 'cus-cargo-summary__metrics'}>
            <span className="cus-cargo-summary__weight">
              {item.cargoMode === 'LCL'
                ? `${formatQuantity(item.weightKg)} kg · ${item.volumeCbm ? `${formatQuantity(item.volumeCbm)} CBM` : '— CBM'}`
                : `${formatQuantity(item.weightKg)} kg`}
            </span>
            <span className={`cus-direction-badge cus-direction-badge--${item.cargoMode?.toLowerCase() || 'unknown'} cus-cargo-mode-tag`}>{cargoModeLabel(item.cargoMode)}</span>
          </span>
        </span></button>
      </td>
      <td data-label="Lịch trình & điều xe" className={item.cargoMode === 'LCL' ? 'cus-dashboard-cell--editable' : 'cus-dashboard-cell--readonly'}>
        {item.cargoMode === 'LCL' ? (
          <button
            id={`cus-inline-schedule-${item.id}`}
            type="button"
            className="cus-inline-trigger"
            data-cell-label="Lịch trình & điều xe"
            disabled={!item.operational.transportDateEditable || quickEditOpen || savingQuickEdit}
            aria-haspopup="dialog"
            aria-label={`Sửa ô lịch trình lô hàng ${identity}`}
            onClick={() => onStartQuickEdit(item, 'schedule')}
          >{scheduleContent}</button>
        ) : <div className="cus-inline-trigger cus-inline-trigger--readonly">{scheduleContent}</div>}
      </td>
      <td data-label="Ghi chú" className="cus-dashboard-cell--editable">
        <button
          id={`cus-inline-notes-${item.id}`}
          type="button"
          className="cus-inline-trigger cus-note-preview"
          data-cell-label="Ghi chú"
          title={[item.customerNotes, item.operationalNotes].filter(Boolean).join('\n') || undefined}
          disabled={!item.operational.transportDateEditable || quickEditOpen || savingQuickEdit}
          aria-haspopup="dialog"
          aria-label={`Sửa ô ghi chú lô hàng ${identity}`}
          onClick={() => onStartQuickEdit(item, 'notes')}
        >
          {customerNoteLines.length > 0 && <span className="cus-note-preview__customer">{customerNoteLines.join(' ')}</span>}
          {operationalNoteLines.length > 0 && <span className="cus-note-internal">{operationalNoteLines.join(' ')}</span>}
          {customerNoteLines.length === 0 && operationalNoteLines.length === 0 && <span className="cus-note-preview__customer cus-note-preview__customer--empty">—</span>}
        </button>
      </td>
      <td data-label="Trạng thái">
        <div className="cus-row-actions">
          <div className="cus-row-actions__summary">
            <WorkflowBadge item={item} />
            {pendingDelete && <span className="cus-workflow-badge cus-workflow-badge--pending-delete">Chờ phê duyệt xóa</span>}
            {primarySignal && PrimarySignalIcon && <span className={`cus-attention-label cus-attention-label--${primarySignal.tone}`}><PrimarySignalIcon size={13} aria-hidden="true" /> {primarySignal.label}</span>}
          </div>
          <div className="cus-row-actions__buttons">
            <UUIButton
              size="sm"
              color="secondary"
              className="cus-dashboard-delete"
              aria-label={`Yêu cầu xóa lô hàng ${identity}`}
              onPress={() => onOpenAction(item, 'delete')}
              isDisabled={editing || pendingDelete}
              iconLeading={<Trash2 size={16} aria-hidden="true" />}
            >
              Xóa
            </UUIButton>
            <UUIButton
              id={'cus-dashboard-detail-' + item.id}
              size="sm"
              color="tertiary"
              className="cus-dashboard-detail"
              aria-haspopup="dialog"
              aria-controls={'cus-detail-drawer-' + item.id}
              aria-label={'Mở chi tiết lô hàng ' + identity + ', trạng thái ' + (item.bucket === ShipmentCusBucket.NEW ? SHIPMENT_STATUS_LABELS[item.status] : item.bucketLabel)}
              onPress={() => onOpenDetail(item.id)}
              isDisabled={editing}
              iconTrailing={ChevronRight}
            >
              Xem chi tiết
            </UUIButton>
          </div>
        </div>
      </td>
    </tr>
  );
}
