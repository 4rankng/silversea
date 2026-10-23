import { DISPATCH_CLASSIFICATION_LABELS } from '@tingting/shared';
import type { DispatchClassification } from '@tingting/shared';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentRequest } from '../../../api/shipmentClient';
import { billBookingReference } from '../../../lib/business-reference';
import { displayNote } from '../../shipments/cus/cusUtils';
import { resolveLiftDropPoints } from '../../shipments/liftDropPoints';
import { LclSelectCheckbox } from '../LclSelectCheckbox';
import { DispatchIssueStatusChip, deriveDispatchIssueStatus } from '../components/DispatchIssueStatus';
import { DispatchPlanEditorCell, type AtomicPlanSaveResult, type IssueOrderResult } from './DispatchPlanEditorCell';
import { DispatchRowActionsMenu } from './DispatchRowActionsMenu';
import { QuickIssueOrderButton } from './QuickIssueOrderButton';
import {
  detailRowKey,
  detailedScheduleLine,
  lclCargoLine,
  lclMeasureLine,
} from './DispatchPlanCellValues';
import { formatWeight } from '../../../lib/format';

/** Owner redesign 23/10 — spec A. The phone card's expanded note payload. */
export interface DispatchCardNoteRequest {
  title: string;
  text: string;
  driver?: boolean;
}

/** Everything the hidden editor-cell mount inside each card needs — the same
 *  bundle the table's Điều phối cell receives, forwarded verbatim by the grid
 *  so the two layouts can never drift in editor behaviour. */
export interface DispatchCardEditorProps {
  onAtomicSave: (
    row: DispatchDetailPlanRow,
    body: {
      carrierType: 'OWN' | 'EXTERNAL';
      externalCarrierId?: number | null;
      truckId?: number | null;
      externalCarrierVehicleId?: number | null;
      plateNumber?: string | null;
      clearVehicle?: boolean;
      plannedRevenue: number | null;
      plannedCarrierCost: number | null;
      classification?: DispatchClassification;
      isCombined?: boolean;
    },
  ) => Promise<AtomicPlanSaveResult>;
  onCompleteExternalTrip: (row: DispatchDetailPlanRow) => void;
  onIssueOrder: (
    row: DispatchDetailPlanRow,
    body: Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>,
  ) => Promise<IssueOrderResult>;
  onEnsureFulfillment?: (row: DispatchDetailPlanRow) => Promise<DispatchDetailPlanRow | null>;
  autoOpenFulfillmentId?: number | null;
  onAutoOpenConsumed?: (id: number) => void;
  onChangeGroupTruck?: (row: DispatchDetailPlanRow) => void;
  editRequest: { key: string; nonce: number } | null;
  onOpenRequestConsumed: () => void;
}

interface DispatchPlanCardListProps extends DispatchCardEditorProps {
  items: DispatchDetailPlanRow[];
  selectedLclShipmentIds?: ReadonlySet<number>;
  onToggleLclSelection?: (shipmentId: number, next: boolean) => void;
  /** Row ⋯ menu wiring (Sửa / Đổi nhà xe/BKS / Phân xe lại / Ghép / Tách nhóm / Xóa lô). */
  onEditPlan: (row: DispatchDetailPlanRow) => void;
  onChangeGroupTruckInline: (row: DispatchDetailPlanRow) => void;
  onOpenTripReassign: (tripId: number) => void;
  onOpenPair?: (row: DispatchDetailPlanRow) => void;
  onUnmergeLclGroup?: (groupId: string) => void;
  onDeleteLot?: (row: DispatchDetailPlanRow) => void;
  /** The group badge opens the grid's Xem nhóm / Hủy ghép modal. */
  onOpenGroupMenu?: (row: DispatchDetailPlanRow) => void;
  /** The truncated note line reopens the full text in the shared dialog. */
  onExpandNote: (note: DispatchCardNoteRequest) => void;
}

/** FB-092/FB-095 — the group tag's tooltip: dimension + truck identity
 *  (same copy the table's badge carries). */
function lclGroupTagTitle(group: { actualTruckNo: string | null; billingTruckNo: string | null }): string {
  return `Ghép trả ĐV · BKS ${group.actualTruckNo ?? '—'}${group.billingTruckNo && group.billingTruckNo !== group.actualTruckNo ? ` · Báo khách ${group.billingTruckNo}` : ''}`;
}

/** The card's one-line note preview: first present note, table-voiced. */
function firstNote(row: DispatchDetailPlanRow): DispatchCardNoteRequest & { preview: string } | null {
  if (row.notes.vehicleNote) {
    return { title: 'Ghi chú xe', text: row.notes.vehicleNote, driver: true, preview: `Xe: ${row.notes.vehicleNote.replace(/\n/g, ' ')}` };
  }
  const ops = row.notes.opsRecoveryNotes?.[0];
  if (ops) return { title: 'Ghi chú OPS', text: ops, preview: `OPS: ${ops.replace(/\n/g, ' ')}` };
  if (row.notes.customerNote) {
    const shown = displayNote(row.notes.customerNote);
    return { title: 'Ghi chú khách hàng', text: shown, preview: `Khách: ${shown.replace(/\n/g, ' ')}` };
  }
  return null;
}

/** Cargo identity line: FCL = serial + [KẸP/KẾT HỢP] + type + weight; LCL =
 *  kind + package + measure (+ vehicle class once grouped). */
function cargoLine(row: DispatchDetailPlanRow): string {
  if (row.cargoMode === 'FCL') {
    const serial = row.container.containerNumber?.trim() || 'Chưa có số cont';
    const pair = row.dispatch.pairKind === 'KEP' ? ' [KẸP]' : row.dispatch.pairKind === 'KET_HOP' ? ' [KẾT HỢP]' : '';
    return [
      `${serial}${pair}`,
      row.container.containerTypeLabel,
      row.container.cargoWeightKg ? formatWeight(row.container.cargoWeightKg) : null,
    ].filter(Boolean).join(' · ');
  }
  return [
    `Lẻ${row.lcl?.group?.vehicleClassCode ? ` · Xe ${row.lcl.group.vehicleClassCode}` : ''}`,
    lclCargoLine(row),
    lclMeasureLine(row),
  ].filter(Boolean).join(' · ');
}

/** Tuyến đi/trả as two short lines (FB-105 §3 LCL lift/drop swap law). */
function routeSides(row: DispatchDetailPlanRow): { lift: string; drop: string } {
  if (row.cargoMode === 'LCL') {
    const points = resolveLiftDropPoints({
      cargoMode: 'LCL',
      tradeDirection: row.docs.tradeDirection,
      warehouseName: row.liftDrop?.warehouseName,
      factoryName: row.customerRoute.factoryName,
      liftFallback: row.liftDrop?.liftFallback,
      dropFallback: row.liftDrop?.dropFallback,
    });
    return { lift: points.lift ?? '—', drop: points.drop ?? '—' };
  }
  return {
    lift: row.ports.pickupPortShortName ?? row.ports.pickupPortName ?? '—',
    drop: row.ports.dropoffPortShortName ?? row.ports.dropoffPortName ?? row.customerRoute.deliveryPoint ?? '—',
  };
}

/** Owner redesign 23/10 (spec A) — the <640px phone card list: one card per
 *  lô/tác vụ. Header = KHÁCH HÀNG + Bill/Booking + badge Loại + chip trạng
 *  thái + the SINGLE ⋯ menu (44px); body = cargo · tuyến 2 dòng · xe/SĐT 1
 *  dòng (không bao giờ wrap ký tự) · ghi chú truncate 1 dòng; foot = nút
 *  chính Phát lệnh/Hoàn thành khi sẵn sàng. The plan editor mounts hidden
 *  per card (its Modal portals to body) so the menu's "Sửa điều phối" opens
 *  the exact same dialog the table serves. */
export function DispatchPlanCardList({
  items, selectedLclShipmentIds, onToggleLclSelection,
  onEditPlan, onChangeGroupTruckInline, onOpenTripReassign, onOpenPair, onUnmergeLclGroup, onDeleteLot,
  onOpenGroupMenu, onExpandNote,
  onAtomicSave, onCompleteExternalTrip, onIssueOrder, onEnsureFulfillment, autoOpenFulfillmentId, onAutoOpenConsumed, onChangeGroupTruck,
  editRequest, onOpenRequestConsumed,
}: DispatchPlanCardListProps) {
  return (
    <ul className="dpcard-list" role="list">
      {items.map((row) => {
        const issueStatus = deriveDispatchIssueStatus({
          vehicleAssigned: row.dispatch.assignedPlate != null,
          carrierAssigned: row.dispatch.externalCarrierId != null,
          issued: row.taskStatus === 'DISPATCHED' && row.dispatch.tripId != null,
          completed: row.taskStatus === 'COMPLETED',
        });
        const canQuickIssue = issueStatus === 'PLATED_NOT_ISSUED' || issueStatus === 'AWAITING_PLATE';
        const canCompleteExternal = row.dispatch.carrierType === 'EXTERNAL'
          && row.dispatch.tripId != null
          && row.taskStatus === 'DISPATCHED';
        const { lift, drop } = routeSides(row);
        const vehicleParts = [
          row.dispatch.assignedPlate,
          row.dispatch.assignedDriverName,
          row.dispatch.assignedDriverPhone,
        ].filter(Boolean).join(' · ');
        const note = firstNote(row);
        const group = row.cargoMode === 'LCL' ? row.lcl?.group : undefined;
        return (
          <li key={detailRowKey(row)} className={`dpcard${row.lotFullyPlated ? ' dpcard--plated' : ''}`}>
            <div className="dpcard__head">
              {onToggleLclSelection && (row.cargoMode === 'LCL' ? (
                <LclSelectCheckbox
                  isSelected={selectedLclShipmentIds?.has(row.shipmentId) ?? false}
                  isDisabled={row.lcl?.group != null}
                  onToggle={(next: boolean) => onToggleLclSelection(row.shipmentId, next)}
                  ariaLabel={`Chọn lô ${billBookingReference(row.docs.billNumber)}`}
                  title={row.lcl?.group != null
                    ? 'Lô đã thuộc nhóm ghép — tách nhóm trước khi ghép lại.'
                    : 'Chọn lô này để gán xe nhóm'}
                />
              ) : (
                /* Spec 23/10 §2 — FCL cards read the mode too, dimmed and
                   untouchable so the merge selection stays LCL-only. */
                <LclSelectCheckbox
                  isSelected={false}
                  isDisabled
                  onToggle={() => {}}
                  ariaLabel={`Lô cont ${row.container.containerNumber ?? ''} không tham gia gộp hàng`}
                  title="Chỉ ghép lô hàng lẻ (LCL) — lô cont không tích được."
                />
              ))}
              <div className="dpcard__identity">
                <span className="dpcard__customer" title={row.customerRoute.customerName ?? undefined}>
                  {row.customerRoute.customerName || '—'}
                </span>
                <span className="dpcard__bill" title={billBookingReference(row.docs.billNumber)}>
                  {billBookingReference(row.docs.billNumber)}
                </span>
              </div>
              <span className="dpcard__type">{DISPATCH_CLASSIFICATION_LABELS[row.classification]}</span>
              <span className="dpcard__issue"><DispatchIssueStatusChip status={issueStatus} /></span>
              <DispatchRowActionsMenu
                row={row}
                onEditPlan={onEditPlan}
                onChangeGroupTruckInline={onChangeGroupTruckInline}
                onOpenTripReassign={onOpenTripReassign}
                onOpenPair={onOpenPair}
                onUnmergeLclGroup={onUnmergeLclGroup}
                onDeleteLot={onDeleteLot}
              />
            </div>
            <div className="dpcard__body">
              <div className="dpcard__line dpcard__line--strong" title={cargoLine(row)}>{cargoLine(row)}</div>
              <div className="dpcard__line" title={lift}>{`Nâng · ${lift}`}</div>
              <div className="dpcard__line" title={drop}>{`Trả · ${drop}`}</div>
              <div className="dpcard__line dpcard__line--muted" title={detailedScheduleLine(row)}>{detailedScheduleLine(row)}</div>
              {vehicleParts && (
                <div className="dpcard__line dpcard__line--vehicle" title={vehicleParts}>{vehicleParts}</div>
              )}
              {group && (onOpenGroupMenu ? (
                <button
                  type="button"
                  className="detailed-plan-grid__lcl-group-tag detailed-plan-grid__lcl-group-tag--action dpcard__group"
                  title={lclGroupTagTitle(group)}
                  onClick={() => onOpenGroupMenu(row)}
                >
                  {`Ghép (${group.order ?? '?'}/${group.memberCount ?? '?'})`}
                </button>
              ) : (
                <span className="detailed-plan-grid__lcl-group-tag dpcard__group" title={lclGroupTagTitle(group)}>
                  {`Ghép (${group.order ?? '?'}/${group.memberCount ?? '?'})`}
                </span>
              ))}
              {note && (
                <button type="button" className="dpcard__note" title="Bấm để xem toàn bộ ghi chú" onClick={() => onExpandNote({ title: note.title, text: note.text, driver: note.driver })}>
                  {note.preview}
                </button>
              )}
            </div>
            {(canQuickIssue || canCompleteExternal) && (
              <div className="dpcard__foot">
                {canQuickIssue && <QuickIssueOrderButton row={row} onIssueOrder={onIssueOrder} variant="labeled" />}
                {canCompleteExternal && (
                  <button
                    type="button"
                    className="detailed-plan-grid__note-action"
                    onClick={() => onCompleteExternalTrip(row)}
                    aria-label={`Hoàn thành · ${row.container.containerNumber?.trim() || billBookingReference(row.docs.billNumber)}`}
                    title="Hoàn thành chuyến với xe ngoài — xe ngoài không dùng app nên điều vận/CUS chốt thay"
                  >
                    Hoàn thành
                  </button>
                )}
              </div>
            )}
            {/* The plan editor: facts hidden (the card prints its own compact
                assignment line), dialog portalled to body by the shared Modal. */}
            <div className="dpcard__editor">
              <DispatchPlanEditorCell
                row={row}
                onAtomicSave={onAtomicSave}
                onOpenTripReassign={onOpenTripReassign}
                onCompleteExternalTrip={onCompleteExternalTrip}
                onIssueOrder={onIssueOrder}
                onEnsureFulfillment={onEnsureFulfillment}
                autoOpenFulfillmentId={autoOpenFulfillmentId}
                onAutoOpenConsumed={onAutoOpenConsumed}
                onChangeGroupTruck={onChangeGroupTruck}
                openRequest={editRequest?.key === detailRowKey(row) ? editRequest : null}
                onOpenRequestConsumed={onOpenRequestConsumed}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
