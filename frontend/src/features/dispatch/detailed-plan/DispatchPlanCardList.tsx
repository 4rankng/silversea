import { useEffect, useRef, useState } from 'react';
import { DISPATCH_CLASSIFICATION_LABELS } from '@tingting/shared';
import type { DispatchClassification } from '@tingting/shared';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentRequest } from '../../../api/shipmentClient';
import { billBookingReference } from '../../../lib/business-reference';
import { useToastOptional } from '../../../components/shared/Toast';
import { displayNote } from '../../shipments/cus/cusUtils';
import { resolveLiftDropPoints } from '../../shipments/liftDropPoints';
import { LclSelectCheckbox } from '../LclSelectCheckbox';
import { DispatchIssueStatusChip, deriveDispatchIssueStatus } from '../components/DispatchIssueStatus';
import { DispatchPlanEditorCell, type AtomicPlanSaveResult, type IssueOrderResult } from './DispatchPlanEditorCell';
import { DispatchRowActionsMenu, type RowMenuOpenRequest } from './DispatchRowActionsMenu';
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
 *  package + measure. Issue #13 (card 3-dòng): the lot-kind prefix ("Lẻ") and
 *  the vehicle class ("Xe 3.5T") moved into the 3-line info block (dòng 3 and
 *  dòng 1 respectively), so this line carries only the lot's own cargo. */
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

/** Issue #13 (card 3-dòng, spec A dòng 2) — SĐT nhóm 3-4 số để đọc ra cả ở
 *  390px: digits group from the right in 3s, the leading group keeps the
 *  remainder (VN mobile 10 số → `0985 246 985`). Non-digits (ext suffixes)
 *  collapse; anything too short to group returns as-is. */
export function formatPhoneGroups(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8) return trimmed;
  const groups: string[] = [];
  let rest = digits;
  while (rest.length > 4) {
    groups.unshift(rest.slice(-3));
    rest = rest.slice(0, -3);
  }
  groups.unshift(rest);
  return groups.join(' ');
}

/** Issue #13 (spec A dòng 1) — placeholder parity with the desktop Điều phối
 *  cell: no plate yet reads differently by carrier mode. */
function platePlaceholder(row: DispatchDetailPlanRow): string {
  return row.dispatch.carrierType === 'OWN' ? 'Chưa phân xe' : 'CUS sẽ bổ sung';
}

/** Issue #13 (spec A dòng 3 + C) — Loại lô · tuyến. The classification label
 *  (Đơn/Kẹp/Kết hợp/Lẻ/Lấy Lẻ — the label the old head badge carried) plus
 *  the one-line Nâng → Trả route; when both route sides are missing the
 *  schedule line stands in ("hoặc thời gian"). Completed rows keep this
 *  fallback: the row shape projects no completedAt/POD, and the spec's
 *  "Giao HH:mm dd/mm · POD" is explicitly "nếu có" — never faked here. */
function infoMetaLine(row: DispatchDetailPlanRow, lift: string, drop: string): string {
  const type = DISPATCH_CLASSIFICATION_LABELS[row.classification];
  const sides = [lift, drop].filter((side) => side && side !== '—');
  if (sides.length === 0) return `${type} · ${detailedScheduleLine(row)}`;
  return `${type} · ${sides.join(' → ')}`;
}

/** Owner redesign 23/10 + issue #13 (card 3-dòng, owner screenshots + Gemini
 *  consult 23/10 tối) — the <640px phone card list: one card per lô/tác vụ.
 *  Head = KHÁCH HÀNG + Bill/Booking + status chip (dot-leading, góc phải) +
 *  the DYNAMIC ACTION SLOT (bất kỳ lúc nào ≤1 nút): paper-plane khi chưa
 *  phát lệnh (1-tap Phát lệnh, tác vụ phụ qua tap card), ⋯ khi đã phát
 *  lệnh / chưa phân xe, KHÔNG nút khi hoàn thành (history đóng băng,
 *  DIS-09). Body = 3-dòng info hierarchy (BKS + Xe {class} / Tên · SĐT
 *  không bao giờ truncate / Loại lô · tuyến) + cargo · giờ · ghi chú.
 *  The plan editor mounts hidden per card (its Modal portals to body) so
 *  the menu's "Sửa điều phối" opens the exact same dialog the table serves. */
export function DispatchPlanCardList({
  items, selectedLclShipmentIds, onToggleLclSelection,
  onEditPlan, onChangeGroupTruckInline, onOpenTripReassign, onOpenPair, onUnmergeLclGroup, onDeleteLot,
  onOpenGroupMenu, onExpandNote,
  onAtomicSave, onCompleteExternalTrip, onIssueOrder, onEnsureFulfillment, autoOpenFulfillmentId, onAutoOpenConsumed, onChangeGroupTruck,
  editRequest, onOpenRequestConsumed,
}: DispatchPlanCardListProps) {
  // Issue #13 — the card-body tap → ⋯ menu signal (nonce pattern; the menu
  // consumes it and opens at the tap-time anchor rect).
  const [menuRequest, setMenuRequest] = useState<RowMenuOpenRequest | null>(null);
  const menuNonceRef = useRef(0);
  // Review m3 — a signal whose row unmounts before its menu consumes it
  // (filter change / refetch in the same tick) must not linger: a later row
  // mounting under the same detailRowKey would auto-open its menu.
  useEffect(() => {
    if (menuRequest != null && !items.some((item) => detailRowKey(item) === menuRequest.key)) {
      setMenuRequest(null);
    }
  }, [items, menuRequest]);
  // Review M1 — a failed 1-tap release reports through the shared toast
  // (owner law: errors in accessible toast/popover), never as text stuffed
  // into the 44px head slot. Null-safe: hosts without the provider keep the
  // button's inline role="alert" paragraph (QuickIssueOrderButton default).
  const toastApi = useToastOptional();
  const quickIssueOnError = toastApi
    ? (message: string) => toastApi.toast({ kind: 'error', message })
    : undefined;

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
        const completed = row.taskStatus === 'COMPLETED';
        const { lift, drop } = routeSides(row);
        const identity = row.container.containerNumber?.trim() || billBookingReference(row.docs.billNumber);
        const vehicleClass = row.cargoMode === 'LCL' ? row.lcl?.group?.vehicleClassCode : null;
        const driverName = row.dispatch.assignedDriverName?.trim() || null;
        const driverPhone = row.dispatch.assignedDriverPhone?.trim() || null;
        const note = firstNote(row);
        const group = row.cargoMode === 'LCL' ? row.lcl?.group : undefined;
        const rowKey = detailRowKey(row);
        const openMenuFromCard = (anchor: { top: number; left: number; right: number; bottom: number }) => {
          menuNonceRef.current += 1;
          setMenuRequest({ key: rowKey, nonce: menuNonceRef.current, anchorRect: anchor });
        };
        // The 3-line info block (spec A). A button on live rows: tapping it
        // opens the ⋯ menu (the "tác vụ phụ qua tap card" law — unissued cards
        // carry no ⋯ trigger). Completed rows are frozen history: plain text.
        const infoBlock = (
          <>
            <span className="dpcard__info-top">
              <span className="dpcard__plate" title={row.dispatch.assignedPlate ?? platePlaceholder(row)}>
                {row.dispatch.assignedPlate ?? platePlaceholder(row)}
              </span>
              {vehicleClass && <span className="dpcard__plate-class">{`Xe ${vehicleClass}`}</span>}
            </span>
            <span className="dpcard__driver">
              {/* The separator rides the NAME span: when the line overflows,
                  ellipsis only ever eats the name — the SĐT span is a
                  nowrap non-shrinking run and can never truncate (spec A). */}
              <span className="dpcard__driver-name" title={driverName ?? 'Chưa có tài xế'}>
                {driverName ? `${driverName} ·` : 'Chưa có tài xế'}
              </span>
              {driverPhone && (
                <span className="dpcard__driver-phone" title={`SĐT lái xe: ${driverPhone}`}>
                  {formatPhoneGroups(driverPhone)}
                </span>
              )}
            </span>
            <span className="dpcard__info-meta" title={`${DISPATCH_CLASSIFICATION_LABELS[row.classification]} · Nâng ${lift} → Trả ${drop}`}>
              {infoMetaLine(row, lift, drop)}
            </span>
          </>
        );
        return (
          <li key={rowKey} className={`dpcard${row.lotFullyPlated ? ' dpcard--plated' : ''}${completed ? ' dpcard--completed' : ''}`}>
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
              <span className="dpcard__issue"><DispatchIssueStatusChip status={issueStatus} /></span>
              {/* Issue #13 (spec B) — the DYNAMIC ACTION SLOT: exactly one
                  VISIBLE button, chosen by state. Paper-plane keeps 1-tap
                  Phát lệnh (owner law) with the ⋯ menu mounted triggerless
                  beside it (opens by card tap); the ⋯ trigger stands in once
                  a trip is live or nothing is issuable; completed cards show
                  no action at all (frozen history — no dead triggers). */}
              {!completed && (
                <div className="dpcard__action">
                  {canQuickIssue && (
                    <QuickIssueOrderButton row={row} onIssueOrder={onIssueOrder} variant="icon" onError={quickIssueOnError} />
                  )}
                  <DispatchRowActionsMenu
                    row={row}
                    onEditPlan={onEditPlan}
                    onChangeGroupTruckInline={onChangeGroupTruckInline}
                    onOpenTripReassign={onOpenTripReassign}
                    onOpenPair={onOpenPair}
                    onUnmergeLclGroup={onUnmergeLclGroup}
                    onDeleteLot={onDeleteLot}
                    onCompleteExternalTrip={canCompleteExternal ? onCompleteExternalTrip : undefined}
                    triggerless={canQuickIssue}
                    openRequest={menuRequest?.key === rowKey ? menuRequest : null}
                    onOpenRequestConsumed={() => setMenuRequest(null)}
                  />
                </div>
              )}
            </div>
            {completed ? (
              <div className="dpcard__info dpcard__info--static">{infoBlock}</div>
            ) : (
              <button
                type="button"
                className="dpcard__info"
                aria-label={`Mở thao tác dòng · ${identity}`}
                aria-haspopup="menu"
                title="Mở thao tác dòng (Sửa điều phối · Ghép · Xóa lô…)"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  openMenuFromCard({ top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom });
                }}
              >
                {infoBlock}
              </button>
            )}
            <div className="dpcard__body">
              <div className="dpcard__line dpcard__line--strong" title={cargoLine(row)}>{cargoLine(row)}</div>
              <div className="dpcard__line dpcard__line--muted" title={detailedScheduleLine(row)}>{detailedScheduleLine(row)}</div>
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
                openRequest={editRequest?.key === rowKey ? editRequest : null}
                onOpenRequestConsumed={onOpenRequestConsumed}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
