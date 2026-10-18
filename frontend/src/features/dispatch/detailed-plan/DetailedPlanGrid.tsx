import { useState } from 'react';
import { X } from 'lucide-react';
import { EmptyState, TextField } from '../../../design-system';
import { SkeletonTable } from '../../../components/shared/Skeleton';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { useToastOptional } from '../../../components/shared/Toast';
import { DISPATCH_CLASSIFICATION_LABELS } from '@tingting/shared';
import type { DispatchClassification } from '@tingting/shared';
import type { DispatchDetailPlanAssignmentCounts, DispatchDetailPlanRow, ZoneTruckPresenceItem } from '../../../api/dispatchPlanningClient';
import { updateLclTruck } from '../../../api/dispatchPlanningClient';
import { Modal } from '../../../components/UI';
import {
  DispatchPlanEditorCell,
  type AtomicPlanSaveResult,
  type IssueOrderResult,
} from './DispatchPlanEditorCell';
import { QuickIssueOrderButton } from './QuickIssueOrderButton';
import { DispatchPairAction } from './DispatchPairAction';
import { deriveDispatchIssueStatus } from '../components/DispatchIssueStatus';
import { formatAppointmentGroupLine } from '../../shipments/cus/cusUtils';
import type { DispatchShipmentRequest } from '../../../api/shipmentClient';
import { DetailedPlanFilters } from './DetailedPlanFilters';
import { ZoneTruckPresencePanel } from './ZoneTruckPresencePanel';
import type { DetailedPlanFilterState, DetailPlanSortDirection, DetailPlanSortKey } from './useDispatchDetailPlan';
import { formatISODate } from '../../../lib/format';
import { billBookingReference } from '../../../lib/business-reference';
import { displayNote } from '../../shipments/cus/cusUtils';
import { DispatchDriverNote } from './DispatchDriverNote';
import { detailRowKey } from './DispatchPlanCellValues';
import { resolveLiftDropPoints } from '../../shipments/liftDropPoints';
import { useDispatchTaskTags } from './useDispatchTaskTags';
import { LclSelectCheckbox } from '../LclSelectCheckbox';
import '../LclSelectCheckbox.css';

import '../../../styles/operational-table-typography.css';
import './DetailedPlanGrid.css';
import { formatNumber, formatVolumeCbm, formatWeight } from '../../../lib/format';

/** FB-092 — the LCL CONTAINER cell's cargo line: `{số lượng} {bao bì}`
 *  (e.g. "5 PALLET"); each half joins only when the lot has one. Null when
 *  neither is set (the cell prints its "—" placeholder). */
export function lclCargoLine(row: DispatchDetailPlanRow): string | null {
  const lcl = row.lcl;
  if (!lcl) return null;
  return [
    lcl.packageCount != null ? formatNumber(lcl.packageCount) : null,
    lcl.packageType?.trim() || null,
  ].filter(Boolean).join(' ') || null;
}

/** FB-092 — the LCL CONTAINER cell's measure line: `{kg} · {CBM}`, each half
 *  joining only when the lot has one (CBM is optional for LCL). Falls back to
 *  the weight-only line on pre-FB-092 wire shapes. */
export function lclMeasureLine(row: DispatchDetailPlanRow): string | null {
  const lcl = row.lcl;
  const weight = row.container.cargoWeightKg != null && row.container.cargoWeightKg !== ''
    ? formatWeight(row.container.cargoWeightKg)
    : null;
  if (!lcl) return weight;
  return [
    weight,
    lcl.cargoVolumeCbm ? formatVolumeCbm(lcl.cargoVolumeCbm) : null,
  ].filter(Boolean).join(' · ') || null;
}

/** FB-092/FB-095 — the group tag's tooltip: dimension + truck identity. */
function lclGroupTagTitle(group: { actualTruckNo: string | null; billingTruckNo: string | null }): string {
  return `Ghép trả ĐV · BKS ${group.actualTruckNo ?? '—'}${group.billingTruckNo && group.billingTruckNo !== group.actualTruckNo ? ` · Báo khách ${group.billingTruckNo}` : ''}`;
}

interface DetailedPlanGridProps {
  filters: DetailedPlanFilterState;
  onFilterChange: (patch: Partial<DetailedPlanFilterState>) => void;
  loadDeliveryPointFacets: (q?: string) => Promise<Array<{ id: number; name: string }>>;
  loadPickupPortFacets: (q?: string) => Promise<Array<{ id: number; name: string }>>;
  loadDropoffPortFacets: (q?: string) => Promise<Array<{ id: number; name: string }>>;
  items: DispatchDetailPlanRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  assignmentError: string | null;
  lotBanner: string | null;
  onClearLotBanner: () => void;
  presence: { zone: string; zoneLabel: string; date: string; items: ZoneTruckPresenceItem[] } | null;
  zones: Array<{ code: string; label: string }>;
  /** Card 20261008_3 — the assignment chips' counts, forwarded to the filter
   *  strip (both render sites share them). */
  assignmentCounts?: DispatchDetailPlanAssignmentCounts;
  sortKey: DetailPlanSortKey;
  sortDirection: DetailPlanSortDirection;
  onToggleSort: (key: Exclude<DetailPlanSortKey, null>) => void;
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
      /** Phân loại (Đơn/Kẹp/Kết hợp) — the dispatcher's call since 2026-09-08;
       *  optional so CUS-derived values stay valid when a caller omits it. */
      classification?: DispatchClassification;
      isCombined?: boolean;
    },
  ) => Promise<AtomicPlanSaveResult>;
  onOpenTripReassign: (tripId: number) => void;
  /** Staff close for external-carrier trips (dispatch/CUS on the driver's behalf). */
  onCompleteExternalTrip: (row: DispatchDetailPlanRow) => void;
  /** Decompose-then-edit for fulfillment-less branch rows. */
  onEnsureFulfillment?: (row: DispatchDetailPlanRow) => Promise<DispatchDetailPlanRow | null>;
  /** When the decompose re-keys the row, the cell that started the work is
   *  unmounted mid-await — the surviving cell for this fulfillment opens its
   *  editor instead (20260916_9). */
  autoOpenFulfillmentId?: number | null;
  /** Clears the parent's pending auto-open once consumed. */
  onAutoOpenConsumed?: (id: number) => void;
  onIssueOrder: (
    row: DispatchDetailPlanRow,
    body: Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>,
  ) => Promise<IssueOrderResult>;
  /** Opens the ghép chuyến dialog anchored on this row's trip (optional —
   * pages that don't mount the dialog simply don't get the button). */
  onOpenPair?: (row: DispatchDetailPlanRow) => void;
  /** FB-092 LCL grouping: when present, LCL rows get a selection checkbox and
   *  the toggles flow to the page's selection state (sticky total bar + the
   *  gán-xe-nhóm dialog). Pages that don't pass it see no checkboxes. */
  selectedLclShipmentIds?: ReadonlySet<number>;
  onToggleLclSelection?: (shipmentId: number, next: boolean) => void;
  /** SPEC 18/10/2026 §4 — dispatch-side "Tách nhóm" for a COST group. Shown
   *  on the principal row only (one action per group). */
  onUnmergeLclGroup?: (groupId: string) => void;
  /** FB-095 (card 181026145610) — the group badge opens Xem nhóm / Hủy ghép;
   *  choosing "Hủy ghép" raises the leaving lot so the page can confirm the
   *  SPEC §4 promotion guard before calling the server. */
  onUnmergeLclLot?: (request: LclUnmergeLotRequest) => void;
  /** Card B 18/10 (B.1) — called after the badge menu's "Đổi nhà xe/BKS"
   *  saved through updateLclTruck, so the page refetches the rows (the
   *  group's BKS pair + every member's planned plate may have moved). */
  onLclTruckUpdated?: () => void;
  /** Card 191026100010 (DV-B1-03/04) — "Đổi BKS nhóm" sau khi đã Gán xe nhóm:
   *  raised from the group menu AND from the plan editor's group line; the
   *  page owns the dialog + the refetch (same wiring law as Hủy ghép). */
  onChangeGroupTruck?: (row: DispatchDetailPlanRow) => void;
}

/** FB-095 — the leaving lot's identity for the confirm guard copy. */
export interface LclUnmergeLotRequest {
  shipmentId: number;
  order: number | null;
  memberCount: number | null;
}

/**
 * "Kế hoạch Chi tiết" grid (docx §5): one row per container (or LCL shipment),
 * 9 multi-line columns, in-row plate assignment. Rows are pre-derived from the
 * carrier allocation made on the master-plan screen.
 */
export function DetailedPlanGrid({
  filters,
  onFilterChange,
  loadDeliveryPointFacets,
  loadPickupPortFacets,
  loadDropoffPortFacets,
  items,
  loading,
  error,
  onRetry,
  assignmentError,
  lotBanner,
  onClearLotBanner,
  presence,
  zones,
  assignmentCounts,
  sortKey,
  sortDirection,
  onToggleSort,
  onAtomicSave,
  onOpenTripReassign,
  onCompleteExternalTrip,
  onIssueOrder,
  onOpenPair,
  selectedLclShipmentIds,
  onToggleLclSelection,
  onUnmergeLclGroup,
  onUnmergeLclLot,
  onLclTruckUpdated,
  onChangeGroupTruck,
  onEnsureFulfillment,
  autoOpenFulfillmentId,
  onAutoOpenConsumed,
}: DetailedPlanGridProps) {
  // Long notes clamp to three lines; tapping reopens the full text in a
  // dialog so the column stays scannable without hiding content.
  const [expandedNote, setExpandedNote] = useState<{ title: string; text: string; driver?: boolean } | null>(null);
  // FB-095 — the grouped row whose badge menu (Xem nhóm / Hủy ghép) is open.
  const [groupMenuRow, setGroupMenuRow] = useState<DispatchDetailPlanRow | null>(null);
  // Card B 18/10 (B.1) — the badge menu's "Đổi nhà xe/BKS" edit state: the
  // BKS pair pre-filled from the group, saved through the FB-093 endpoint
  // (`updateLclTruck` — actual rewrites every group member, billing the named
  // lot only), with the page refetching via `onLclTruckUpdated`.
  const [groupTruckDraft, setGroupTruckDraft] = useState<{ actual: string; billing: string } | null>(null);
  const [savingGroupTruck, setSavingGroupTruck] = useState(false);
  const [groupTruckError, setGroupTruckError] = useState<string | null>(null);
  const toastCtx = useToastOptional();
  // `items` is ONE server page of the plan, so Xem nhóm can only see the
  // on-page members of the group — the menu says how many live elsewhere.
  const groupMenuMembers = groupMenuRow?.lcl?.group
    ? items
      .filter((member) => member.lcl?.group?.groupId === groupMenuRow.lcl?.group?.groupId)
      .sort((a, b) => (a.lcl?.group?.order ?? 0) - (b.lcl?.group?.order ?? 0))
    : [];
  const groupMenuMissing = (groupMenuRow?.lcl?.group?.memberCount ?? 0) - groupMenuMembers.length;
  const { tags } = useDispatchTaskTags();
  const taskLabels = tags.map((tag) => tag.label);

  // P1 (post-cut#4 mount regression, QA _58 repro): a transient failure on a
  // 30s background-refresh tick must NOT collapse the grid to the error
  // branch — that unmounted the table mid-edit (inline editors died) and the
  // surface read as "zero rows". With rows already loaded, the failure
  // renders as a non-blocking banner over the intact table; the full-branch
  // error state stays reserved for a cold load with nothing to show.
  if (error && items.length === 0) {
    return (
      <>
        <DetailedPlanFilters filters={filters} onChange={onFilterChange} loadDeliveryPointFacets={loadDeliveryPointFacets} loadPickupPortFacets={loadPickupPortFacets} loadDropoffPortFacets={loadDropoffPortFacets} zones={zones} assignmentCounts={assignmentCounts} />
        <div className="dispatch-plan-page__error" role="alert">
          <span>{error}</span>
          {/* Sweep (card 20261008_1): the retry used to disable silently
              while a reload was in flight — same aria-described explanation
              as /dispatch's retry (card 081026093510). */}
          <DisabledActionTip id="detailed-plan-retry-cold" reason={loading ? 'Đang tải dữ liệu…' : null}>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => { if (loading) return; onRetry(); }}
              aria-disabled={loading || undefined}
            >
              Thử lại
            </button>
          </DisabledActionTip>
        </div>
      </>
    );
  }

  return (
    <>
      <DetailedPlanFilters filters={filters} onChange={onFilterChange} loadDeliveryPointFacets={loadDeliveryPointFacets} loadPickupPortFacets={loadPickupPortFacets} loadDropoffPortFacets={loadDropoffPortFacets} zones={zones} assignmentCounts={assignmentCounts} />

      <ZoneTruckPresencePanel
        items={presence?.items ?? []}
        zoneLabel={presence?.zoneLabel ?? ''}
        date={presence?.date ?? null}
        onSelectPlate={(plate) => onFilterChange({ q: plate })}
      />

      {assignmentError && (
        <div className="dispatch-plan-page__error" role="alert">{assignmentError}</div>
      )}

      {error && items.length > 0 && (
        <div className="dispatch-plan-page__error" role="alert">
          <span>{error}</span>
          <DisabledActionTip id="detailed-plan-retry-banner" reason={loading ? 'Đang tải dữ liệu…' : null}>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => { if (loading) return; onRetry(); }}
              aria-disabled={loading || undefined}
            >
              Thử lại
            </button>
          </DisabledActionTip>
        </div>
      )}

      {lotBanner && (
        <div className="detailed-plan-grid__lot-banner" role="status">
          <span>{lotBanner}</span>
          <button type="button" onClick={onClearLotBanner} aria-label="Đóng thông báo"><X size={16} aria-hidden="true" /></button>
        </div>
      )}

      {loading ? (
        <div role="status">
          <SkeletonTable rows={6} cols={9} />
          <span className="sr-only">Đang tải dữ liệu…</span>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          context="dispatch"
          title="Không có dòng kế hoạch nào"
          description="Các container của lô đã phân bổ nhà xe sẽ xuất hiện ở đây."
        />
      ) : (
        <div className="detailed-plan-grid__wrapper">
          <table className="detailed-plan-grid ops-table">
            <colgroup>
              <col className="detailed-plan-grid__col detailed-plan-grid__col--schedule" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--route" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--ports" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--ports" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--documents" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--container" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--assignment" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--classification" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--notes" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" aria-sort={sortKey === 'runHour' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined}>
                  <button
                    type="button"
                    className={`detailed-plan-grid__sort${sortKey === 'runHour' ? ' is-sorted' : ''}`}
                    onClick={() => onToggleSort('runHour')}
                    aria-label="Sắp xếp theo giờ chạy"
                  >
                    Thời gian &amp; lịch trình {sortKey === 'runHour' ? (sortDirection === 'desc' ? '▼' : '▲') : '↕'}
                  </button>
                </th>
                <th scope="col" aria-sort={sortKey === 'customer' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined}>
                  <button
                    type="button"
                    className={`detailed-plan-grid__sort${sortKey === 'customer' ? ' is-sorted' : ''}`}
                    onClick={() => onToggleSort('customer')}
                    aria-label="Sắp xếp theo khách hàng"
                  >
                    Khách hàng &amp; lộ trình {sortKey === 'customer' ? (sortDirection === 'desc' ? '▼' : '▲') : '↕'}
                  </button>
                </th>
                <th scope="col">Nâng hàng</th>
                {/* The delivery-point sort belongs to the column that shows the
                    drop; the customer column owns the customer ordering. */}
                <th scope="col" aria-sort={sortKey === 'deliveryPoint' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : undefined}>
                  <button
                    type="button"
                    className={`detailed-plan-grid__sort${sortKey === 'deliveryPoint' ? ' is-sorted' : ''}`}
                    onClick={() => onToggleSort('deliveryPoint')}
                    aria-label="Sắp xếp theo điểm trả"
                  >
                    Trả hàng {sortKey === 'deliveryPoint' ? (sortDirection === 'desc' ? '▼' : '▲') : '↕'}
                  </button>
                </th>
                <th scope="col">Tuyến đường</th>
                <th scope="col">Container</th>
                <th scope="col">Điều phối</th>
                <th scope="col">Phân loại</th>
                <th scope="col">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                // Row action BENEATH the notes (customer placement ruling):
                // "Phát lệnh" for plated-not-issued rows, "Hoàn thành" for
                // external trips in flight — same derivation as the
                // assignment cell's chip; the two conditions are mutually
                // exclusive. Computed up front so the notes cell can also
                // tell the narrow-card CSS whether it renders anything at
                // all (an all-empty notes cell collapses on phones).
                const issueStatus = deriveDispatchIssueStatus({
                  vehicleAssigned: row.dispatch.assignedPlate != null,
                  carrierAssigned: row.dispatch.externalCarrierId != null,
                  issued: row.taskStatus === 'DISPATCHED' && row.dispatch.tripId != null,
                  completed: row.taskStatus === 'COMPLETED',
                });
                // Card 20261004_359 — deferred-plate external rows quick-issue
                // exactly like plated ones (the issue body ships no plate).
                const canQuickIssue = issueStatus === 'PLATED_NOT_ISSUED' || issueStatus === 'AWAITING_PLATE';
                const canCompleteExternal = row.dispatch.carrierType === 'EXTERNAL'
                  && row.dispatch.tripId != null
                  && row.taskStatus === 'DISPATCHED';
                const actionLabel = canQuickIssue
                  ? 'Phát lệnh'
                  : canCompleteExternal ? 'Hoàn thành' : null;
                const notesCellBlank = !row.notes.vehicleNote && !row.notes.customerNote && !row.notes.opsRecoveryNotes?.length && actionLabel == null;
                // PM 03/10 (card 20261003_304): a present date renders ALONE —
                // the '—' placeholder never prefixes it. The bare dash stays
                // only for a fully unknown schedule (no date, no hour).
                // Card 20261002_269 (PM R34): the saved Giờ trả hàng shows in
                // this column the moment it is saved — the staged plannedEndAt
                // outranks the appointment-derived run timestamp, so the
                // dispatcher sees 13:00 immediately after Lưu, and after reload.
                // Card 20261003_318: the delivery-date fallback is LABELLED —
                // a bare date read as a stored return hour sent the user into
                // the editor expecting it there.
                const scheduleValue = row.plannedEndAt
                  ? formatAppointmentGroupLine(row.plannedEndAt)
                  : row.time.runAt ? formatAppointmentGroupLine(row.time.runAt)
                    : row.time.runHour != null
                      ? [`${row.time.runHour}H`, row.time.deliveryDate ? formatISODate(row.time.deliveryDate) : null].filter(Boolean).join(' ')
                      : row.time.deliveryDate ? `Ngày giao ${formatISODate(row.time.deliveryDate)}`
                        : '—';
                const differentTransportDate = row.time.runAt && row.time.deliveryDate && formatISODate(row.time.runAt) !== formatISODate(row.time.deliveryDate) ? formatISODate(row.time.deliveryDate) : null;
                return (
                <tr key={detailRowKey(row)} className={`detailed-plan-grid__row${row.lotFullyPlated ? ' detailed-plan-grid__row--plated' : ''}`}>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--schedule" data-label="Thời gian & lịch trình" data-label-short="Giờ">
                    {/* FB-043: every cell rides the fixed-height body so row
                        height is uniform by construction, not by column
                        tuning (the R22/141026001010 regression class). */}
                    <div className="detailed-plan-grid__cell-body">
                      {onToggleLclSelection && row.cargoMode === 'LCL' && (
                        <LclSelectCheckbox
                          isSelected={selectedLclShipmentIds?.has(row.shipmentId) ?? false}
                          onToggle={(next: boolean) => onToggleLclSelection(row.shipmentId, next)}
                          ariaLabel={`Chọn lô ${billBookingReference(row.docs.billNumber)}`}
                          title="Chọn lô này để gán xe nhóm"
                        />
                      )}
                      <div className="ops-schedule">
                        <strong className="ops-schedule__datetime" title={scheduleValue}>{scheduleValue}</strong>
                        <span className="detailed-plan-grid__line detailed-plan-grid__line--muted" data-empty={!row.docs.tradeDirection ? 'true' : undefined} title={row.docs.tradeDirection || differentTransportDate ? `${row.docs.tradeDirection === 'IMPORT' ? 'trả hàng' : row.docs.tradeDirection === 'EXPORT' ? 'đóng hàng' : ''}${differentTransportDate ? ` · Ngày vận chuyển: ${differentTransportDate}` : ''}` : undefined}>
                          {row.docs.tradeDirection === 'IMPORT' ? 'trả hàng' : row.docs.tradeDirection === 'EXPORT' ? 'đóng hàng' : '—'}
                          {differentTransportDate && ` · Ngày vận chuyển: ${differentTransportDate}`}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--route" data-label="Khách hàng & lộ trình" data-label-short="Khách">
                    <div className="detailed-plan-grid__cell-body">
                      <div className="detailed-plan-grid__line detailed-plan-grid__line--strong" title={row.customerRoute.customerName ?? undefined}>
                        {row.customerRoute.customerName}
                      </div>
                      <div className="detailed-plan-grid__line" data-empty={!row.customerRoute.factoryName ? 'true' : undefined} title={row.customerRoute.factoryName ?? undefined}>
                        {row.customerRoute.factoryName ?? '—'}
                      </div>
                      <div className="detailed-plan-grid__line detailed-plan-grid__line--strong detailed-plan-grid__route-bill" data-empty={!row.docs.billNumber ? 'true' : undefined} title={row.docs.billNumber ?? undefined}>
                        {row.docs.billNumber ? `Bill: ${row.docs.billNumber}` : '—'}
                      </div>
                    </div>
                  </td>
                  {/* FB-105 §3: an LCL lot owns no container, so its Nâng/Trả
                      columns are the lot's OWN lift/drop points, which SWAP with
                      the trade direction (Nhập: kho → nhà máy; Xuất: nhà máy →
                      kho) — the shared rule every surface reads
                      (liftDropPoints.ts). FCL keeps its container port pair:
                      those ports already MEAN Cảng nâng/Cảng hạ in entry, CUS
                      and the master plan, so they are never reversed. */}
                  {(() => {
                    if (row.cargoMode === 'LCL') {
                      const points = resolveLiftDropPoints({
                        cargoMode: 'LCL',
                        tradeDirection: row.docs.tradeDirection,
                        warehouseName: row.liftDrop?.warehouseName,
                        factoryName: row.customerRoute.factoryName,
                        liftFallback: row.liftDrop?.liftFallback,
                        dropFallback: row.liftDrop?.dropFallback,
                      });
                      const sides = [
                        { key: 'lift', label: 'Nâng hàng', short: 'Nâng', title: points.lift },
                        { key: 'drop', label: 'Trả hàng', short: 'Trả', title: points.drop },
                      ] as const;
                      return (
                        <>
                          {sides.map((side) => (
                            <td
                              key={side.key}
                              className="detailed-plan-grid__cell detailed-plan-grid__cell--ports"
                              data-label={side.label}
                              data-label-short={side.short}
                              data-empty={side.title ? undefined : 'true'}
                            >
                              <div className="detailed-plan-grid__cell-body">
                                <div className="detailed-plan-grid__line" title={side.title ?? undefined}>{side.title ?? '—'}</div>
                              </div>
                            </td>
                          ))}
                        </>
                      );
                    }
                    const liftPort = row.ports.pickupPortName;
                    const liftShort = row.ports.pickupPortShortName;
                    const dropPort = row.ports.dropoffPortName;
                    const dropShort = row.ports.dropoffPortShortName;
                    return (
                      <>
                        <td className="detailed-plan-grid__cell detailed-plan-grid__cell--ports" data-label="Nâng hàng" data-label-short="Nâng" data-empty={!liftShort && !liftPort ? 'true' : undefined}>
                          <div className="detailed-plan-grid__cell-body">
                            <div className="detailed-plan-grid__line" title={liftShort ?? liftPort ?? undefined}>{liftShort ?? liftPort ?? '—'}</div>
                            {liftShort && liftPort && liftShort !== liftPort && (
                              <div className="detailed-plan-grid__line detailed-plan-grid__line--muted" title={liftPort}>{liftPort}</div>
                            )}
                          </div>
                        </td>
                        <td className="detailed-plan-grid__cell detailed-plan-grid__cell--ports" data-label="Trả hàng" data-label-short="Trả" data-empty={!dropShort && !dropPort ? 'true' : undefined}>
                          <div className="detailed-plan-grid__cell-body">
                            <div className="detailed-plan-grid__line" title={dropShort ?? dropPort ?? undefined}>{dropShort ?? dropPort ?? '—'}</div>
                            {dropShort && dropPort && dropShort !== dropPort && (
                              <div className="detailed-plan-grid__line detailed-plan-grid__line--muted" title={dropPort}>{dropPort}</div>
                            )}
                          </div>
                        </td>
                      </>
                    );
                  })()}
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--documents" data-label="Tuyến đường" data-label-short="Tuyến">
                    <div className="detailed-plan-grid__cell-body">
                      <div className="detailed-plan-grid__route-direction">
                        {row.customerRoute.routeName ? (
                          <div className="detailed-plan-grid__line detailed-plan-grid__line--strong" title={row.customerRoute.routeName}>{row.customerRoute.routeName}</div>
                        ) : row.customerRoute.deliveryPoint ? (
                          <div className="detailed-plan-grid__line detailed-plan-grid__line--muted" title={row.customerRoute.deliveryPoint}>{row.customerRoute.deliveryPoint}</div>
                        ) : (
                          <div className="detailed-plan-grid__line detailed-plan-grid__line--muted">Chưa có tuyến đường</div>
                        )}
                        <div className="detailed-plan-grid__line detailed-plan-grid__documents-direction">
                          {row.docs.tradeDirection === 'IMPORT' ? (
                            <span>Nhập</span>
                          ) : row.docs.tradeDirection === 'EXPORT' ? (
                            <span>Xuất</span>
                          ) : '—'}
                        </div>
                      </div>
                      {row.isCombined && (
                        <span className="detailed-plan-grid__combined-note" title="Đóng kết hợp">
                          Kết hợp
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--container" data-label="Container" data-label-short="Cont">
                    <div className="detailed-plan-grid__cell-body">
                      {row.cargoMode === 'FCL' ? (
                        <>
                          {row.container.containerNumber ? (
                            <div className="detailed-plan-grid__line detailed-plan-grid__line--strong" title={`${row.container.containerNumber}${row.dispatch.pairKind ? ` ${row.dispatch.pairKind === 'KEP' ? '[KẸP]' : '[KẾT HỢP]'}` : ''}`}>
                              {row.container.containerNumber}
                              {row.dispatch.pairKind && (
                                <span className="detailed-plan-grid__pair-tag">
                                  {row.dispatch.pairKind === 'KEP' ? '[KẸP]' : '[KẾT HỢP]'}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="detailed-plan-grid__line detailed-plan-grid__line--missing">Chưa có số cont</div>
                          )}
                          <div className="detailed-plan-grid__line" data-empty={!row.container.containerTypeLabel ? 'true' : undefined} title={row.container.containerTypeLabel ?? undefined}>{row.container.containerTypeLabel ?? '—'}</div>
                          <div className="detailed-plan-grid__line detailed-plan-grid__line--muted" data-empty={row.container.cargoWeightKg == null || row.container.cargoWeightKg === '' ? 'true' : undefined} title={formatWeight(row.container.cargoWeightKg)}>
                            {formatWeight(row.container.cargoWeightKg)}
                          </div>
                        </>
                      ) : (
                        <>
                          {/* FB-092: a containerless lot states its own kind,
                              cargo and (when grouped) its truck class — never
                              a container placeholder (FB-091 law). */}
                          <div className="detailed-plan-grid__line detailed-plan-grid__line--strong">
                            Lẻ{row.lcl?.group?.vehicleClassCode ? ` · Xe ${row.lcl.group.vehicleClassCode}` : ''}
                          </div>
                          <div
                            className="detailed-plan-grid__line"
                            data-empty={row.lcl?.packageCount == null && !row.lcl?.packageType ? 'true' : undefined}
                            title={lclCargoLine(row) ?? undefined}
                          >
                            {lclCargoLine(row) ?? '—'}
                          </div>
                          <div
                            className="detailed-plan-grid__line detailed-plan-grid__line--muted"
                            data-empty={lclMeasureLine(row) == null ? 'true' : undefined}
                            title={lclMeasureLine(row) ?? undefined}
                          >
                            {lclMeasureLine(row) ?? '—'}
                          </div>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--editable" data-label="Điều phối" data-label-short="Điều phối">
                    <DispatchPlanEditorCell
                      row={row}
                      onAtomicSave={onAtomicSave}
                      onOpenTripReassign={onOpenTripReassign}
                      onEnsureFulfillment={onEnsureFulfillment}
                      autoOpenFulfillmentId={autoOpenFulfillmentId}
                      onAutoOpenConsumed={onAutoOpenConsumed}
                      onCompleteExternalTrip={onCompleteExternalTrip}
                      onIssueOrder={onIssueOrder}
                      onChangeGroupTruck={onChangeGroupTruck}
                    />
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--classification" data-label="Phân loại" data-label-short="Loại">
                    <div className="detailed-plan-grid__cell-body detailed-plan-grid__cell-body--row">
                      <span className="detailed-plan-grid__classification">
                        {DISPATCH_CLASSIFICATION_LABELS[row.classification]}
                      </span>
                      {/* FB-095 — with the page wired, the badge is the group's
                          action surface (Xem nhóm / Hủy ghép); unwired it stays
                          a static tag exactly like the pre-FB-095 badge. */}
                      {row.cargoMode === 'LCL' && row.lcl?.group && (onUnmergeLclLot ? (
                        <button
                          type="button"
                          className="detailed-plan-grid__lcl-group-tag detailed-plan-grid__lcl-group-tag--action"
                          title={lclGroupTagTitle(row.lcl.group)}
                          onClick={() => setGroupMenuRow(row)}
                        >
                          {`Lẻ · Ghép (${row.lcl.group.order ?? '?'}/${row.lcl.group.memberCount ?? '?'})`}
                        </button>
                      ) : (
                        <span
                          className="detailed-plan-grid__lcl-group-tag"
                          title={lclGroupTagTitle(row.lcl.group)}
                        >
                          {`Lẻ · Ghép (${row.lcl.group.order ?? '?'}/${row.lcl.group.memberCount ?? '?'})`}
                        </span>
                      ))}
                      {/* SPEC 18/10/2026 §4 — one group action, anchored on Lô 1. */}
                      {row.cargoMode === 'LCL'
                        && row.lcl?.group
                        && row.lcl.group.order === 1
                        && onUnmergeLclGroup && (
                          <button
                            type="button"
                            className="detailed-plan-grid__lcl-unmerge"
                            title="Tách nhóm ghép — mỗi lô trở về cước trả ĐV độc lập"
                            onClick={() => onUnmergeLclGroup(row.lcl!.group!.groupId)}
                          >
                            Tách nhóm
                          </button>
                        )}
                      <DispatchPairAction row={row} onOpenPair={onOpenPair} />
                    </div>
                  </td>
                  <td className={`detailed-plan-grid__cell detailed-plan-grid__cell--notes${notesCellBlank ? ' detailed-plan-grid__cell--blank' : ''}`} data-label="Ghi chú" data-label-short="Ghi chú">
                    {/* FB-043: the note stack flexes inside the fixed body so
                        the row action never clips — long notes give ground
                        (their full text is one click away in the dialog). */}
                    <div className="detailed-plan-grid__cell-body detailed-plan-grid__cell-body--notes">
                      <div className="detailed-plan-grid__note-stack">
                        {row.notes.vehicleNote && (
                          <button
                            type="button"
                            className="detailed-plan-grid__note"
                            onClick={() => setExpandedNote({ title: 'Ghi chú xe', text: row.notes.vehicleNote ?? '', driver: true })}
                            title="Bấm để xem toàn bộ ghi chú"
                          >
                            <DispatchDriverNote value={row.notes.vehicleNote} labels={taskLabels} compact />
                          </button>
                        )}
                        {row.notes.opsRecoveryNotes?.map(note => <button key={note} type="button" className="detailed-plan-grid__note" onClick={() => setExpandedNote({ title: 'Ghi chú OPS', text: note })}><span className="detailed-plan-grid__line detailed-plan-grid__note-clamp" style={{ whiteSpace: 'pre-wrap' }}><strong>OPS: </strong>{note}</span></button>)}
                        {row.notes.customerNote && (
                          <button
                            type="button"
                            className="detailed-plan-grid__note"
                            onClick={() => setExpandedNote({ title: 'Ghi chú khách hàng', text: displayNote(row.notes.customerNote) })}
                            title="Bấm để xem toàn bộ ghi chú"
                          >
                            <span className="detailed-plan-grid__line detailed-plan-grid__line--muted detailed-plan-grid__note-clamp">
                              {`Khách: ${displayNote(row.notes.customerNote)}`.split('\n').map((line, i) => (
                                <span key={i} className="detailed-plan-grid__note-line">{line}</span>
                              ))}
                            </span>
                          </button>
                        )}
                      </div>
                      <div className="detailed-plan-grid__note-actions">
                        {canQuickIssue && <QuickIssueOrderButton row={row} onIssueOrder={onIssueOrder} />}
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
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        isOpen={expandedNote != null}
        title={expandedNote?.title ?? ''}
        onClose={() => setExpandedNote(null)}
        maxWidth={520}
      >
        {expandedNote?.driver
          ? <DispatchDriverNote value={expandedNote.text} labels={taskLabels} />
          : <p className="detailed-plan-grid__note-full">{expandedNote?.text ?? ''}</p>}
      </Modal>

      {/* FB-095 — the badge menu: Xem nhóm (members + truck identity) and the
          group's actions. Card B 18/10 (B.1) adds "Đổi nhà xe/BKS": the
          group's BKS pair edits in place (pre-filled), saving through the
          FB-093 `updateLclTruck` endpoint — the one write that keeps the whole
          cost group (and the lots' planned plates) coherent. The page owns the
          SPEC §4 confirm guard for Hủy ghép — the grid only raises the leaving
          lot. */}
      <Modal
        isOpen={groupMenuRow != null}
        title={`Nhóm ghép trả ĐV · Lẻ (${groupMenuRow?.lcl?.group?.order ?? '?'}/${groupMenuRow?.lcl?.group?.memberCount ?? '?'})`}
        onClose={() => { setGroupMenuRow(null); setGroupTruckDraft(null); setGroupTruckError(null); }}
        maxWidth={420}
        footer={(
          <>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setGroupMenuRow(null); setGroupTruckDraft(null); setGroupTruckError(null); }}>Đóng</button>
            {groupTruckDraft == null && (
              <>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                    const group = groupMenuRow?.lcl?.group;
                    if (!groupMenuRow || !group) return;
                    setGroupTruckDraft({
                      actual: group.actualTruckNo ?? '',
                      billing: group.billingTruckNo ?? '',
                    });
                    setGroupTruckError(null);
                  }}
                >
                  Đổi nhà xe/BKS
                </button>
                {onChangeGroupTruck && groupMenuRow && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => {
                      onChangeGroupTruck(groupMenuRow);
                      setGroupMenuRow(null);
                    }}
                  >
                    Đổi BKS nhóm
                  </button>
                )}
              </>
            )}
            {groupTruckDraft != null && (
              <DisabledActionTip
                id="lcl-group-truck-save"
                reason={savingGroupTruck ? 'Đang lưu xe nhóm…' : null}
              >
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  aria-disabled={savingGroupTruck || undefined}
                  onClick={() => {
                    if (!groupMenuRow || savingGroupTruck) return;
                    const group = groupMenuRow.lcl?.group;
                    if (!group) return;
                    const actual = groupTruckDraft.actual.trim();
                    const billing = groupTruckDraft.billing.trim();
                    if ((!actual || actual === (group.actualTruckNo ?? '')) && (!billing || billing === (group.billingTruckNo ?? ''))) {
                      setGroupTruckError('Chưa có gì thay đổi — sửa BKS thực hoặc BKS báo khách trước khi lưu.');
                      return;
                    }
                    setSavingGroupTruck(true);
                    setGroupTruckError(null);
                    void updateLclTruck({
                      shipmentId: groupMenuRow.shipmentId,
                      ...(actual !== (group.actualTruckNo ?? '') && actual !== '' ? { actualTruckNo: actual } : {}),
                      ...(billing !== (group.billingTruckNo ?? '') && billing !== '' ? { billingTruckNo: billing } : {}),
                    })
                      .then((result) => {
                        toastCtx?.toast({
                          kind: 'success',
                          message: `Đã đổi xe nhóm — ${result.updatedShipmentIds.length} lô cập nhật BKS.`,
                        });
                        setGroupMenuRow(null);
                        setGroupTruckDraft(null);
                        onLclTruckUpdated?.();
                      })
                      .catch((err: unknown) => {
                        setGroupTruckError(err instanceof Error ? err.message : 'Đổi xe nhóm thất bại');
                      })
                      .finally(() => setSavingGroupTruck(false));
                  }}
                >
                  {savingGroupTruck ? 'Đang lưu…' : 'Lưu xe nhóm'}
                </button>
              </DisabledActionTip>
            )}
            {groupTruckDraft == null && (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => {
                  const group = groupMenuRow?.lcl?.group;
                  if (!groupMenuRow || !group || !onUnmergeLclLot) return;
                  onUnmergeLclLot({
                    shipmentId: groupMenuRow.shipmentId,
                    order: group.order,
                    memberCount: group.memberCount,
                  });
                  setGroupMenuRow(null);
                }}
              >
                Hủy ghép
              </button>
            )}
          </>
        )}
      >
        {groupMenuRow?.lcl?.group && (
          <div className="detailed-plan-grid__lcl-group-menu">
            {groupTruckDraft == null && (
              <>
                <p className="detailed-plan-grid__line detailed-plan-grid__line--strong">
                  {lclGroupTagTitle(groupMenuRow.lcl.group)}
                </p>
                {groupMenuRow.lcl.group.vehicleClassName && (
                  <p className="detailed-plan-grid__line detailed-plan-grid__line--muted">
                    {`Loại xe: ${groupMenuRow.lcl.group.vehicleClassName}`}
                  </p>
                )}
              </>
            )}
            {groupTruckDraft != null && (
              <div>
                {/* Card B 18/10 (B.1): the scope law the dispatcher must see
                    before saving — actual = the WHOLE group's truck, billing =
                    THIS lot's "xe báo khách" only. */}
                <TextField
                  id="lcl-group-truck-actual"
                  label="BKS thực (cả nhóm ghép)"
                  autoComplete="off"
                  value={groupTruckDraft.actual}
                  onChange={(event) => setGroupTruckDraft((current) => (current == null ? current : { ...current, actual: event.target.value }))}
                />
                <TextField
                  id="lcl-group-truck-billing"
                  label="BKS báo khách (riêng lô này)"
                  autoComplete="off"
                  value={groupTruckDraft.billing}
                  onChange={(event) => setGroupTruckDraft((current) => (current == null ? current : { ...current, billing: event.target.value }))}
                />
              </div>
            )}
            {groupTruckError && (
              <p className="detailed-plan-grid__line detailed-plan-grid__line--warning" role="alert">{groupTruckError}</p>
            )}
            {groupTruckDraft == null && (
              <>
                <p className="detailed-plan-grid__line detailed-plan-grid__line--muted">Thành viên nhóm:</p>
                <ul className="detailed-plan-grid__lcl-group-menu-list">
                  {groupMenuMembers.map((member) => (
                    <li key={member.shipmentId} className="detailed-plan-grid__line">
                      {`Lô ${member.lcl?.group?.order ?? '?'} · ${billBookingReference(member.docs.billNumber)}`}
                    </li>
                  ))}
                </ul>
                {groupMenuMissing > 0 && (
                  <p className="detailed-plan-grid__line detailed-plan-grid__line--muted">
                    {`Còn ${groupMenuMissing} thành viên ở trang khác`}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </Modal>

    </>
  );
}
