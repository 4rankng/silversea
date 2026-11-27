import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { EmptyState, TextField, UuiSelectField } from '../../../design-system';
import { SkeletonTable } from '../../../components/shared/Skeleton';
import { DisabledActionTip } from '../../../components/shared/DisabledActionTip';
import { NameCell } from '../../../components/shared/NameCell';
import { useToastOptional } from '../../../components/shared/Toast';
import { DISPATCH_CLASSIFICATION_LABELS } from '@tingting/shared';
import type { DispatchClassification } from '@tingting/shared';
import type { DispatchDetailPlanAssignmentCounts, DispatchDetailPlanRow, ZoneTruckPresenceItem } from '../../../api/dispatchPlanningClient';
import { costGroupOf, updateLclTruck } from '../../../api/dispatchPlanningClient';
import { Modal } from '../../../components/UI';
import {
  DispatchPlanEditorCell,
  type AtomicPlanSaveResult,
  type IssueOrderResult,
} from './DispatchPlanEditorCell';
import { QuickIssueOrderButton } from './QuickIssueOrderButton';
import { DispatchRowActionsMenu } from './DispatchRowActionsMenu';
import { DispatchPlanCardList } from './DispatchPlanCardList';
import { deriveDispatchIssueStatus } from '../components/DispatchIssueStatus';
import type { DispatchShipmentRequest } from '../../../api/shipmentClient';
import { DetailedPlanFilters } from './DetailedPlanFilters';
import { bulkIssueEligibility } from './bulkIssueOrders';
import { detectIssueSoftConfirm, detectSaveSoftConfirm, type SoftSaveConfirmFlag } from './dispatchSoftConfirm';
import { ZoneTruckPresencePanel } from './ZoneTruckPresencePanel';
import type { DetailedPlanFilterState, DetailPlanSortDirection, DetailPlanSortKey } from './useDispatchDetailPlan';
import { formatISODate } from '../../../lib/format';
import { billBookingReference } from '../../../lib/business-reference';
import { displayNote } from '../../shipments/cus/cusUtils';
import { isNoteLong } from '../master-plan/MasterPlanNoteModal';
import { DispatchDriverNote } from './DispatchDriverNote';
import { detailRowKey, detailedScheduleLine, detailedDemandLine, lclCargoLine, lclMeasureLine, classificationOptionsForRow } from './DispatchPlanCellValues';
import { ENSURE_FULFILLMENT_FAILED_MESSAGE } from './ensureFulfillment';
import { resolveLiftDropPoints } from '../../shipments/liftDropPoints';
import { useDispatchTaskTags } from './useDispatchTaskTags';
import { DispatchDeclarationCell } from './DispatchDeclarationCell';
import { DispatchContainerNumberCell } from './DispatchContainerNumberCell';
import { LclSelectCheckbox } from '../LclSelectCheckbox';
import '../LclSelectCheckbox.css';

// FB-092 helpers moved to the shared cell-vocabulary module (owner redesign
// 23/10: the mobile card list reads the same derivation). Re-exported here so
// the existing import surface (tests, siblings) keeps working.
export { lclCargoLine, lclMeasureLine } from './DispatchPlanCellValues';

import '../../../styles/operational-table-typography.css';
import '../dispatch-row-menu.css';
import './DetailedPlanGrid.css';
import { formatWeight } from '../../../lib/format';

/** Owner redesign 23/10 — the phone card list takes over below this
 *  CONTAINER width (measured on the grid's own wrapper, not the viewport:
 *  the workspace is the layout container at every zoom/sidebar state). */
const CARD_MODE_BREAKPOINT = 640;

/** Measures the wrapper's inline size and reports whether the card list
 *  owns the layout. jsdom (unit tests) has no ResizeObserver: the table is
 *  the default and card suites drive the card list directly. The anchor is
 *  a STATE callback ref, not a mount-time effect: the wrapper only renders
 *  once rows have loaded (the skeleton branch has none), so an effect keyed
 *  on `[]` ran against a null element and never observed the real node. */
function useCardLayoutMode(): [React.Dispatch<React.SetStateAction<HTMLDivElement | null>>, boolean] {
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  const [isCardMode, setIsCardMode] = useState(false);
  useEffect(() => {
    if (!anchorEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      // Master-plan lane fix (review M1, same defect class): measure the
      // BORDER box — a classic scrollbar on the pane shrinks the content box
      // ~15px and a contentRect measurement oscillates table↔cards at the
      // 640px boundary (the pane this lane added makes the board overflow,
      // so the scrollbar case is now reachable on this board too).
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

/** FB-092/FB-095 — the group tag's tooltip: dimension + truck identity. */
// SIL-537: the group tag names ONLY the BKS thực. "BKS báo khách" (ảo) is a
// CUS-side output and must not surface anywhere on the Điều vận side (spec
// 23/10 §1, GP-03 sweep; display half removed 27/10).
function lclGroupTagTitle(group: { actualTruckNo: string | null; dimension?: 'COST' | 'REV' }): string {
  // SIL-1166 — a rev group (Gộp hàng) merges the THU side, so its tag names
  // that dimension; the cost group keeps the ĐV copy.
  return `${group.dimension === 'REV' ? 'Ghép thu cước' : 'Ghép trả ĐV'} · BKS ${group.actualTruckNo ?? '—'}`;
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
      carrierType: 'OWN' | 'EXTERNAL' | null;
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
      /** SIL-638 TC6.2 (id 742) — soft weight warning confirmation retry. */
      kepWeightWarningConfirmed?: boolean;
    },
  ) => Promise<AtomicPlanSaveResult>;
  /** SIL-708 — Hủy phân xe flow for live issued trips. */
  onCancelDispatch?: (row: DispatchDetailPlanRow) => void;
  /** SIL-714 — Cập nhật biển số for a live EXTERNAL trip awaiting its plate. */
  onUpdateExternalPlate?: (row: DispatchDetailPlanRow) => void;
  /** SIL-694 (id 806) — optional: hosts gate it by role (the staff close is
   *  ADMIN/MANAGER/DISPATCHER/CUS only); undefined removes every "Hoàn thành"
   *  affordance below (menu item, card slot, editor button). */
  onCompleteExternalTrip?: (row: DispatchDetailPlanRow) => void;
  /** Decompose-then-edit for fulfillment-less branch rows. The inline
   *  PHÂN LOẠI save passes `{ autoOpen: false }` — it must never pop the
   *  full editor modal (SIL-667); the editor cell omits it and inherits the
   *  auto-open. */
  onEnsureFulfillment?: (row: DispatchDetailPlanRow, options?: { autoOpen?: boolean }) => Promise<DispatchDetailPlanRow | null>;
  /** When the decompose re-keys the row, the cell that started the work is
   *  unmounted mid-await — the surviving cell for this fulfillment opens its
   *  editor instead (20260916_9). */
  autoOpenFulfillmentId?: number | null;
  /** Clears the parent's pending auto-open once consumed. */
  onAutoOpenConsumed?: (id: number) => void;
  onIssueOrder: (
    row: DispatchDetailPlanRow,
    body: Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'> & {
      kepWeightWarningConfirmed?: boolean;
    },
  ) => Promise<IssueOrderResult>;
  /** Opens the ghép chuyến dialog anchored on this row's trip (optional —
   * pages that don't mount the dialog simply don't get the button). */
  onOpenPair?: (row: DispatchDetailPlanRow) => void;
  /** FB-092 LCL grouping: when present, LCL rows get a selection checkbox and
   *  the toggles flow to the page's selection state (sticky total bar + the
   *  gán-xe-nhóm dialog). Pages that don't pass it see no checkboxes.
   *  Spec 23/10 (261023110000 §2): the CHỌN column is ON-DEMAND — pages pass
   *  it only while the [📦 Gộp hàng] mode is active, so the default table
   *  keeps its full reading width. */
  selectedLclShipmentIds?: ReadonlySet<number>;
  onToggleLclSelection?: (shipmentId: number, next: boolean) => void;
  /** Spec 23/10 §2 — the filter strip's [📦 Gộp hàng] mode + its toggle,
   *  forwarded to the grid's own DetailedPlanFilters render sites. */
  lclMergeMode?: boolean;
  onToggleLclMergeMode?: () => void;
  onAssignSelectedLcl?: () => void;
  /** SIL-884 (5.1) — [Phát lệnh hàng loạt] mode: ON reveals the leading
   *  checkboxes gated to 'Đã điều xe' rows without a lệnh yet. The page owns
   *  the selection set + the batch release (same on-demand law as Gộp hàng). */
  bulkIssueMode?: boolean;
  selectedBulkFulfillmentIds?: ReadonlySet<number>;
  /** BUG-03 retest (SIL-898) — the row rides the toggle: the page keeps a
   *  global pick map, so ticks from earlier searches release even when a
   *  later search no longer lists the row. */
  onToggleBulkSelection?: (fulfillmentId: number, next: boolean, row: DispatchDetailPlanRow) => void;
  /** Band controls passthrough (page owns the batch state): the toggle,
   *  the selected count for [Phát lệnh đã chọn (N)], the run + busy flag. */
  onToggleBulkIssueMode?: () => void;
  bulkIssueCount?: number;
  onBulkIssueSelected?: () => void;
  bulkIssueBusy?: boolean;
  /** HOT-04 (CR-011.2) — in-place [+ Gán xe] quick-assign selection mode. */
  quickAssignMode?: boolean;
  selectedQuickAssignKeys?: ReadonlySet<string>;
  onToggleQuickAssignSelection?: (rowKey: string, next: boolean, row: DispatchDetailPlanRow) => void;
  onToggleQuickAssignMode?: () => void;
  /** SPEC 18/10/2026 §4 — dispatch-side "Tách nhóm" for a COST group. Shown
   *  on the principal row only (one action per group). */
  onUnmergeLclGroup?: (groupId: string) => void;
  /** SIL-1021 (KB Ch.3 §3.5 K3.50) — the row ⋯ menu's "Hủy ghép" on a paired
   *  row: unpair the ACTIVE trip pair, both legs return to Đơn. */
  onUnpairTrip?: (row: DispatchDetailPlanRow) => void;
  /** SIL-590 (id 690) — the row ⋯ menu's "Gộp hàng": enters the page's
   *  on-demand merge mode with this row pre-picked, so gộp hàng lẻ happens
   *  in place on this screen (never a navigation to Kế hoạch Tổng quát).
   *  Pages pass it only while the merge mode is OFF — when the mode is on,
   *  the CHỌN checkboxes own the flow. */
  onStartLclMerge?: (row: DispatchDetailPlanRow) => void;
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
  /** CR-011.2 Q8 — "Thêm lô vào nhóm" on a grouped LCL row: the page owns
   *  the eligible-lot dialog + the refetch (same wiring law as Đổi BKS). */
  onAddLotsToGroup?: (row: DispatchDetailPlanRow) => void;
  /** Card 211026005623 (FB-095) — "Xóa lô" row action raised to the page's
   *  delete flow. The page routes it: delete-authorized roles (CUS/ADMIN law
   *  — cards 351/352 + 20261007_396) open the confirm + lý do dialog →
   *  DELETE /api/shipments/cus-workspace/:id (FB-095 promote-on-delete guards
   *  server-side); other roles get the guard's own law text inline (card
   *  20260923_1 — the affordance answers, never vanishes). Unwired pages see
   *  no button (parity with Tách nhóm). */
  onDeleteLot?: (row: DispatchDetailPlanRow) => void;
  /** SIL-591 — called after the SỐ TỜ KHAI cell saves: a declaration write
   *  can auto-copy onto the lot's still-empty siblings (FB-109), so the page
   *  refetches the rows instead of patching one cell in place. */
  onRowsChanged?: () => void;
  /** SIL-638 TC6.2 (id 742) — soft weight warning confirmation callback. */
  pendingWeightWarning?: {
    message: string;
    confirm: () => Promise<void>;
    cancel: () => void;
  } | null;
}

/** FB-095 — the leaving lot's identity for the confirm guard copy. */
export interface LclUnmergeLotRequest {
  shipmentId: number;
  order: number | null;
  memberCount: number | null;
}

/**
 * "Kế hoạch Chi tiết" grid (docx §5): one row per container (or LCL shipment),
 * 10 multi-line columns, in-row plate assignment. Rows are pre-derived from the
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
  onCancelDispatch,
  onUpdateExternalPlate,
  onCompleteExternalTrip,
  onIssueOrder,
  onOpenPair,
  selectedLclShipmentIds,
  onToggleLclSelection,
  lclMergeMode,
  onStartLclMerge,
  onToggleLclMergeMode,
  onAssignSelectedLcl,
  bulkIssueMode,
  selectedBulkFulfillmentIds,
  onToggleBulkSelection,
  onToggleBulkIssueMode,
  bulkIssueCount,
  onBulkIssueSelected,
  bulkIssueBusy,
  quickAssignMode,
  selectedQuickAssignKeys,
  onToggleQuickAssignSelection,
  onToggleQuickAssignMode,
  onUnmergeLclGroup,
  onUnpairTrip,
  onUnmergeLclLot,
  onLclTruckUpdated,
  onChangeGroupTruck,
  onAddLotsToGroup,
  onDeleteLot,
  onRowsChanged,
  onEnsureFulfillment,
  autoOpenFulfillmentId,
  onAutoOpenConsumed,
  pendingWeightWarning,
}: DetailedPlanGridProps) {
  // SIL-515: notes render in full (no clamp); the dialog is the focused
  // reading view for a long note, not the place where its tail is stored.
  const [expandedNote, setExpandedNote] = useState<{ title: string; text: string; driver?: boolean } | null>(null);
  // FB-095 — the grouped row whose badge menu (Xem nhóm / Hủy ghép) is open.
  const [groupMenuRow, setGroupMenuRow] = useState<DispatchDetailPlanRow | null>(null);
  // Card B 18/10 (B.1) — the badge menu's "Đổi nhà xe/BKS" edit state: the
  // BKS thực pre-filled from the group, saved through the FB-093 endpoint
  // (`updateLclTruck` — actual rewrites every group member). GP-03: no
  // billing field — billingTruckNo is the CUS-side identity and never rides
  // this ĐV write — with the page refetching via `onLclTruckUpdated`.
  const [groupTruckDraft, setGroupTruckDraft] = useState<{ actual: string } | null>(null);
  const [savingGroupTruck, setSavingGroupTruck] = useState(false);
  const [groupTruckError, setGroupTruckError] = useState<string | null>(null);
  // DIS-09 (card 211026130015) — the row menu's "Đổi nhà xe/BKS" lands in the
  // SAME edit state the badge menu's button drives: modal open + pre-filled
  // BKS, one click from the row without opening the badge first.
  const openGroupTruckEdit = (row: DispatchDetailPlanRow) => {
    // SIL-1166 — cost-side verb only (rev groups are display-only).
    const group = costGroupOf(row.lcl?.group);
    if (!group) return;
    setGroupMenuRow(row);
    setGroupTruckDraft({
      actual: group.actualTruckNo ?? '',
    });
    setGroupTruckError(null);
  };
  // Owner redesign 23/10 — the row ⋯ menu replaces every inline trigger. Its
  // "Sửa điều phối" opens the row's plan editor through this signal: the
  // matching DispatchPlanEditorCell (table cell or hidden card mount) picks
  // it up, runs the same guarded openEditor (live-trip reroute + branch
  // decompose included) and consumes the request.
  const [editRequest, setEditRequest] = useState<{ key: string; nonce: number; focusVehicle?: boolean } | null>(null);
  const editNonceRef = useRef(0);
  const requestEditPlan = (row: DispatchDetailPlanRow) => {
    editNonceRef.current += 1;
    setEditRequest({ key: detailRowKey(row), nonce: editNonceRef.current });
  };
  // DIS-10 / K4.19 (SIL-955): the ⋯ menu's 'Đổi nhà xe/BKS' opens the SAME
  // governed 'Chỉnh sửa điều phối' dialog the menu's 'Sửa điều phối' opens —
  // the verb names the vehicle intent, so the dialog puts the caret on the
  // Xe / biển số picker. It never bypasses the live-trip reroute: on a row
  // that owns a live trip the plan save is refused by the backend (409), so
  // the governed path there stays Hủy phân xe (SIL-708).
  const requestChangeVehicle = (row: DispatchDetailPlanRow) => {
    editNonceRef.current += 1;
    setEditRequest({ key: detailRowKey(row), nonce: editNonceRef.current, focusVehicle: true });
  };
  const consumeEditRequest = () => setEditRequest(null);

  // SIL-648 (id 753) — PHÂN LOẠI column inline edit on the detailed-plan grid.
  const [editingClassificationKey, setEditingClassificationKey] = useState<string | null>(null);
  const [savingClassificationKey, setSavingClassificationKey] = useState<string | null>(null);
  const [optimisticClassifications, setOptimisticClassifications] = useState<Record<string, DispatchClassification>>({});
  const [inlineClassificationError, setInlineClassificationError] = useState<string | null>(null);

  // SIL-638 TC6.2 (id 742) — soft weight warning confirmation in the grid banner
  const [localWeightWarning, setLocalWeightWarning] = useState<{
    message: string;
    confirm: () => Promise<void>;
    cancel: () => void;
  } | null>(null);
  const activeWeightWarning = pendingWeightWarning ?? localWeightWarning;

  // SIL-669 — one inline save per pick. A duplicate classification commit
  // (programmatic/harness re-dispatch, double commit, a stale-closure re-pick
  // on the re-keyed fresh row) rides the same closures as the pick already
  // saving: its PATCH carries the same expectedFulfillmentVersion, 409s against
  // the in-flight save, and paints the fake "đã thay đổi" banner on a save that
  // actually succeeded. One entry per PHYSICAL row (container namespace, else
  // lot namespace — never merged), keyed with the same target value only, so
  // the decompose re-key cannot re-arm it and a genuinely different pick (or a
  // re-pick after a failed attempt — the entry is released on every exit)
  // saves as usual.
  const inlineSaveInFlightRef = useRef<Map<string, DispatchClassification>>(new Map());

  const handleInlineClassificationSave = async (row: DispatchDetailPlanRow, nextClassification: DispatchClassification) => {
    const rowKey = detailRowKey(row);
    if (nextClassification === row.classification) {
      setEditingClassificationKey(null);
      return;
    }
    const rowIdentity = row.shipmentContainerId != null ? `c:${row.shipmentContainerId}` : `s:${row.shipmentId}`;
    if (inlineSaveInFlightRef.current.get(rowIdentity) === nextClassification) {
      return;
    }
    inlineSaveInFlightRef.current.set(rowIdentity, nextClassification);
    try {
      await handleInlineClassificationSaveGuarded(row, nextClassification, rowKey, rowIdentity);
    } finally {
      if (inlineSaveInFlightRef.current.get(rowIdentity) === nextClassification) {
        inlineSaveInFlightRef.current.delete(rowIdentity);
      }
    }
  };

  const handleInlineClassificationSaveGuarded = async (
    row: DispatchDetailPlanRow,
    nextClassification: DispatchClassification,
    rowKey: string,
    _rowIdentity: string,
  ) => {
    setOptimisticClassifications((prev) => ({ ...prev, [rowKey]: nextClassification }));
    setSavingClassificationKey(rowKey);
    setInlineClassificationError(null);

    // SIL-667 — a fulfillment-less branch row has no editor identity: saving
    // straight through PATCHed `/dispatch-detail-plan-rows/null/plan`, which
    // 400s while the grid read as saved. Resolve the fulfillment FIRST (the
    // same decompose the Điều phối editor uses) and save against it — or fail
    // loudly; a /null/ request must never leave this handler.
    let saveRow = row;
    let activeKey = rowKey;
    if (row.fulfillmentId == null) {
      if (!onEnsureFulfillment) {
        const msg = 'Dòng chưa có phân xe — dùng Chỉnh sửa điều phối để phân xe trước khi đổi phân loại.';
        setOptimisticClassifications((prev) => {
          const next = { ...prev };
          delete next[rowKey];
          return next;
        });
        setSavingClassificationKey(null);
        setEditingClassificationKey(null);
        setInlineClassificationError(msg);
        toastCtx?.toast({ kind: 'error', message: msg });
        return;
      }
      let ensured: DispatchDetailPlanRow | null = null;
      try {
        // autoOpen: false — this save owns the inline select; the hook's
        // surviving-cell auto-open would pop the full Chỉnh sửa điều phối
        // modal over the grid and its stale draft could revert the save.
        ensured = await onEnsureFulfillment(row, { autoOpen: false });
      } catch {
        ensured = null;
      }
      if (ensured == null || ensured.fulfillmentId == null) {
        // A contract-violating decompose response (no fulfillment id) must
        // not slip through to a /null/ save either — the guard is
        // unconditional because AC1 is absolute.
        // ensureFulfillmentFor already put the precise reason on the grid
        // banner (role="alert"); the toast repeats the shared failure
        // sentence so the failure is never silent, and the optimistic value
        // drops off the stale row.
        setOptimisticClassifications((prev) => {
          const next = { ...prev };
          delete next[rowKey];
          return next;
        });
        setSavingClassificationKey(null);
        setEditingClassificationKey(null);
        toastCtx?.toast({ kind: 'error', message: ENSURE_FULFILLMENT_FAILED_MESSAGE });
        return;
      }
      saveRow = ensured;
      // The decompose re-keys the row (container key → fulfillment key) —
      // move the in-flight select state to the fresh key so it stays open on
      // the optimistic value instead of flickering back to the stored one.
      // The abandoned container-key entry is deleted: it must never mask the
      // stored value if that row ever re-renders on its old key.
      activeKey = detailRowKey(ensured);
      setOptimisticClassifications((prev) => {
        const next = { ...prev, [activeKey]: nextClassification };
        delete next[rowKey];
        return next;
      });
      setSavingClassificationKey(activeKey);
      setEditingClassificationKey(activeKey);
    }

    try {
      const parseEst = (val: string | null) => (val && val.trim() ? Number(val) : null);
      await onAtomicSave(saveRow, {
        carrierType: saveRow.dispatch.carrierType ?? 'OWN',
        externalCarrierId: saveRow.dispatch.carrierType === 'EXTERNAL' ? saveRow.dispatch.externalCarrierId ?? null : null,
        plannedRevenue: parseEst(saveRow.estimates.plannedRevenue),
        plannedCarrierCost: parseEst(saveRow.estimates.plannedCarrierCost),
        classification: nextClassification,
        isCombined: nextClassification === 'COMBINED',
      });
      setEditingClassificationKey(null);
    } catch (err: unknown) {
      setOptimisticClassifications((prev) => {
        const next = { ...prev };
        delete next[activeKey];
        return next;
      });
      setEditingClassificationKey(null);
      const e = err as { status?: number; message?: string; raw?: { code?: string }; code?: string };
      const soft = detectSaveSoftConfirm(err);
      const msg = e.message || 'Không thể lưu phân loại. Vui lòng thử lại.';
      const scheduleInlineConfirm = (
        softMatch: NonNullable<ReturnType<typeof detectSaveSoftConfirm>>,
        accumulatedFlags: Partial<Record<SoftSaveConfirmFlag, boolean>>,
      ) => {
        setLocalWeightWarning({
          message: softMatch.message,
          confirm: async () => {
            setLocalWeightWarning(null);
            setInlineClassificationError(null);
            const parseEst = (val: string | null) => (val && val.trim() ? Number(val) : null);
            const nextFlags: Partial<Record<SoftSaveConfirmFlag, boolean>> = {
              ...accumulatedFlags,
              [softMatch.flag]: true,
            };
            try {
              await onAtomicSave(saveRow, {
                carrierType: saveRow.dispatch.carrierType ?? 'OWN',
                externalCarrierId: saveRow.dispatch.carrierType === 'EXTERNAL' ? saveRow.dispatch.externalCarrierId ?? null : null,
                plannedRevenue: parseEst(saveRow.estimates.plannedRevenue),
                plannedCarrierCost: parseEst(saveRow.estimates.plannedCarrierCost),
                classification: nextClassification,
                isCombined: nextClassification === 'COMBINED',
                ...nextFlags,
              });
              setOptimisticClassifications((prev) => ({ ...prev, [activeKey]: nextClassification }));
            } catch (retryError) {
              const nextSoft = detectSaveSoftConfirm(retryError);
              if (nextSoft != null && nextFlags[nextSoft.flag] !== true) {
                scheduleInlineConfirm(nextSoft, nextFlags);
                toastCtx?.toast({ kind: 'warning', message: nextSoft.message });
                return;
              }
              // The banner was dismissed with the warning — a failed confirmed
              // retry must speak for itself or it becomes a silent failure.
              // The optimistic value reverts: nothing was saved.
              const retryErr = retryError as { message?: string };
              const retryMsg = retryErr.message || 'Không thể lưu phân loại. Vui lòng thử lại.';
              setOptimisticClassifications((prev) => {
                const next = { ...prev };
                delete next[activeKey];
                return next;
              });
              setInlineClassificationError(retryMsg);
              toastCtx?.toast({ kind: 'error', message: retryMsg });
            }
          },
          cancel: () => {
            setLocalWeightWarning(null);
            setInlineClassificationError(null);
          },
        });
      };
      if (soft != null) {
        scheduleInlineConfirm(soft, {});
      } else {
        setInlineClassificationError(msg);
      }
      toastCtx?.toast({ kind: soft != null ? 'warning' : 'error', message: msg });
    } finally {
      setSavingClassificationKey(null);
    }
  };

  const handleQuickIssueOrder = async (
    targetRow: DispatchDetailPlanRow,
    body: Omit<DispatchShipmentRequest, 'fulfillmentId' | 'expectedVersion'>,
  ) => {
    try {
      return await onIssueOrder(targetRow, body);
    } catch (issueErr: unknown) {
      const soft = detectIssueSoftConfirm(issueErr);
      const alreadyConfirmed = soft != null
        && (body as Record<string, unknown>)[soft.flag] === true;
      if (soft != null && !alreadyConfirmed) {
        setLocalWeightWarning({
          message: soft.message,
          confirm: async () => {
            setLocalWeightWarning(null);
            try {
              await handleQuickIssueOrder(targetRow, { ...body, [soft.flag]: true });
            } catch {
              // Handled inside handleQuickIssueOrder / onIssueOrder (next soft warning or terminal error).
            }
          },
          cancel: () => {
            setLocalWeightWarning(null);
          },
        });
      }
      throw issueErr;
    }
  };
  // Owner redesign 23/10 (spec A/B) — one markup per mode, measured on the
  // grid's own wrapper: ≥640px keeps the table (scroll box + pinned actions
  // column), below it the phone card list takes over.
  const [layoutAnchorRef, isCardMode] = useCardLayoutMode();
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
        {/* SIL-1108 — [Phát lệnh hàng loạt] works in both table AND mobile card mode. */}
        <DetailedPlanFilters filters={filters} onChange={onFilterChange} loadDeliveryPointFacets={loadDeliveryPointFacets} loadPickupPortFacets={loadPickupPortFacets} loadDropoffPortFacets={loadDropoffPortFacets} zones={zones} assignmentCounts={assignmentCounts} lclMergeMode={lclMergeMode} onToggleLclMergeMode={onToggleLclMergeMode} lclMergeSelectedCount={selectedLclShipmentIds?.size ?? 0} onAssignSelectedLcl={onAssignSelectedLcl} bulkIssueMode={bulkIssueMode} onToggleBulkIssueMode={onToggleBulkIssueMode} bulkIssueCount={bulkIssueCount} onBulkIssueSelected={onBulkIssueSelected} bulkIssueBusy={bulkIssueBusy} quickAssignMode={quickAssignMode} onToggleQuickAssignMode={onToggleQuickAssignMode} />
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
      <DetailedPlanFilters filters={filters} onChange={onFilterChange} loadDeliveryPointFacets={loadDeliveryPointFacets} loadPickupPortFacets={loadPickupPortFacets} loadDropoffPortFacets={loadDropoffPortFacets} zones={zones} assignmentCounts={assignmentCounts} lclMergeMode={lclMergeMode} onToggleLclMergeMode={onToggleLclMergeMode} lclMergeSelectedCount={selectedLclShipmentIds?.size ?? 0} onAssignSelectedLcl={onAssignSelectedLcl} bulkIssueMode={bulkIssueMode} onToggleBulkIssueMode={onToggleBulkIssueMode} bulkIssueCount={bulkIssueCount} onBulkIssueSelected={onBulkIssueSelected} bulkIssueBusy={bulkIssueBusy} quickAssignMode={quickAssignMode} onToggleQuickAssignMode={onToggleQuickAssignMode} />

      <ZoneTruckPresencePanel
        items={presence?.items ?? []}
        zoneLabel={presence?.zoneLabel ?? ''}
        date={presence?.date ?? null}
        onSelectPlate={(plate) => onFilterChange({ q: plate })}
      />

      {(assignmentError || inlineClassificationError || activeWeightWarning) && (
        <div className="dispatch-plan-page__error" role="alert">
          <span>{activeWeightWarning?.message ?? inlineClassificationError ?? assignmentError}</span>
          {activeWeightWarning && (
            <div className="dispatch-plan-page__error-actions">
              <button
                type="button"
                className="btn btn--sm btn--primary detailed-plan-grid__warning-confirm"
                onClick={() => void activeWeightWarning.confirm()}
              >
                Vẫn lưu?
              </button>
              <button
                type="button"
                className="btn btn--sm btn--ghost detailed-plan-grid__warning-cancel"
                onClick={activeWeightWarning.cancel}
              >
                Hủy
              </button>
            </div>
          )}
        </div>
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
          <SkeletonTable rows={6} cols={11} />
          <span className="sr-only">Đang tải dữ liệu…</span>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          context="dispatch"
          title="Không có dòng kế hoạch nào"
          description="Các container của lô đã phân bổ nhà xe sẽ xuất hiện ở đây."
        />
      ) : (
        <div
          ref={layoutAnchorRef}
          className={`detailed-plan-grid__wrapper${isCardMode ? ' detailed-plan-grid__wrapper--cards' : ''}`}
        >
          {isCardMode ? (
            <DispatchPlanCardList
              onStartLclMerge={onStartLclMerge}
              items={items}
              selectedLclShipmentIds={selectedLclShipmentIds}
              onToggleLclSelection={onToggleLclSelection}
              selectedBulkFulfillmentIds={selectedBulkFulfillmentIds}
              onToggleBulkSelection={onToggleBulkSelection}
              onEditPlan={requestEditPlan}
              onChangeVehicle={requestChangeVehicle}
              onChangeGroupTruckInline={openGroupTruckEdit}
              onAddLotsToGroup={onAddLotsToGroup}
              onCancelDispatch={onCancelDispatch}
              onUpdateExternalPlate={onUpdateExternalPlate}
              onOpenPair={onOpenPair}
              onUnmergeLclGroup={onUnmergeLclGroup}
              onDeleteLot={onDeleteLot}
              onOpenGroupMenu={onUnmergeLclLot ? setGroupMenuRow : undefined}
              onExpandNote={setExpandedNote}
              onAtomicSave={onAtomicSave}
              onCompleteExternalTrip={onCompleteExternalTrip}
              onIssueOrder={onIssueOrder}
              onEnsureFulfillment={onEnsureFulfillment}
              autoOpenFulfillmentId={autoOpenFulfillmentId}
              onAutoOpenConsumed={onAutoOpenConsumed}
              onChangeGroupTruck={onChangeGroupTruck}
              editRequest={editRequest}
              onOpenRequestConsumed={consumeEditRequest}
            />
          ) : (
          <table className={`detailed-plan-grid ops-table${onToggleLclSelection || onToggleBulkSelection || onToggleQuickAssignSelection ? ' detailed-plan-grid--selectable' : ''}`}>
            <colgroup>
              {/* Spec 23/10 §2 + SIL-884 (5.1) + HOT-04 — the on-demand select column
                  rides FIRST while [📦 Gộp hàng], [Phát lệnh hàng loạt], OR [+ Gán xe]
                  is active (fixed 48px, master-plan precedent); absent by default
                  so the reading columns keep their shares. */}
              {(onToggleLclSelection || onToggleBulkSelection || onToggleQuickAssignSelection) && <col className="detailed-plan-grid__col detailed-plan-grid__col--select" />}
              <col className="detailed-plan-grid__col detailed-plan-grid__col--schedule" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--route" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--ports" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--ports" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--documents" />
              {/* SIL-1191 (QA wave a8f059c0) — the Điều phối column rides
                  BEFORE the container/declaration metadata: KB §10.3.3 makes
                  it a primary reading column ("không chi tiết nào bị
                  ẩn/cắt"), and at the 1440 sidebar-open canvas its 223px
                  track started past the THAO TÁC rail's fold (x1313 vs the
                  48px rail at x1362), leaving 65% of it covered at rest.
                  Left of the fold it reads whole at scrollLeft 0; the board
                  keeps its sanctioned horizontal scroll (KB §10.3.4) for the
                  tail metadata columns. */}
              <col className="detailed-plan-grid__col detailed-plan-grid__col--assignment" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--container" />
              {/* SIL-591 — the per-container tờ khai column (SIL-521 model). */}
              <col className="detailed-plan-grid__col detailed-plan-grid__col--declaration" />
              {/* K2.31 (SIL-934) — the moóc column: the run's assigned trailer. */}
              <col className="detailed-plan-grid__col detailed-plan-grid__col--trailer" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--classification" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--notes" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--actions" />
            </colgroup>
            <thead>
              <tr>
                {(onToggleLclSelection || onToggleBulkSelection || onToggleQuickAssignSelection) && (
                  <th scope="col" className="detailed-plan-grid__th--select">
                    {onToggleQuickAssignSelection ? 'Gán xe' : onToggleBulkSelection ? (() => {
                      // SIL-893 — the header select-all covers ONLY the rows
                      // eligible for batch release ('Đã điều xe' without a
                      // lệnh); ineligible rows stay dimmed per-row whatever
                      // the header does.
                      const eligibleRows = items
                        .filter((r) => bulkIssueEligibility(r).eligible);
                      const picked = eligibleRows
                        .filter((r) => selectedBulkFulfillmentIds?.has(r.fulfillmentId) ?? false).length;
                      const all = eligibleRows.length > 0 && picked === eligibleRows.length;
                      return (
                        <div className="detailed-plan-grid__select-all">
                          <LclSelectCheckbox
                            isSelected={all}
                            isMixed={picked > 0 && !all}
                            onToggle={(next: boolean) => { eligibleRows.forEach((r) => onToggleBulkSelection(r.fulfillmentId, next, r)); }}
                            ariaLabel="Chọn tất cả dòng đủ điều kiện"
                            title="Chọn tất cả dòng đủ điều kiện phát lệnh hàng loạt"
                          />
                          <span aria-hidden="true">Phát lệnh</span>
                        </div>
                      );
                    })() : 'Chọn lô'}
                  </th>
                )}
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
                {/* SIL-1191 — Điều phối reads whole at scrollLeft 0: the
                    column sits left of the THAO TÁC rail's fold (KB §10.3.3
                    "không chi tiết nào bị ẩn/cắt"). */}
                <th scope="col">Điều phối</th>
                <th scope="col" className="detailed-plan-grid__th--container">Container</th>
                <th scope="col" className="detailed-plan-grid__th--declaration">Số tờ khai</th>
                {/* K2.31 (SIL-934): the run's assigned moóc rides its own column. */}
                <th scope="col">Moóc</th>
                <th scope="col">Phân loại</th>
                <th scope="col">Ghi chú</th>
                {/* Owner redesign 23/10 — the ONE pinned action column: the ⋯
                    row menu (+ the compact primary when ready) lives here,
                    never inside a data cell. */}
                <th scope="col" className="detailed-plan-grid__th--actions">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                // SIL-588 (owner 27/10) — the primary row action ("Phát lệnh"
                // for plated-not-issued rows) rides the PINNED Thao tác column
                // stacked ABOVE the ⋯ menu; "Hoàn thành" for external live
                // trips is a ⋯ MENU ITEM (the menu already owned it since the
                // card 3-dòng redesign), no longer a second pill beside the
                // kebab. The two conditions are mutually exclusive; same
                // derivation as the assignment cell's chip.
                const issueStatus = deriveDispatchIssueStatus({
                  vehicleAssigned: row.dispatch.assignedPlate != null,
                  carrierAssigned: row.dispatch.externalCarrierId != null,
                  issued: row.taskStatus === 'DISPATCHED' && row.dispatch.tripId != null,
                  completed: row.taskStatus === 'COMPLETED',
                });
                // Card 20261004_359 — deferred-plate external rows quick-issue
                // exactly like plated ones (the issue body ships no plate).
                const canQuickIssue = issueStatus === 'PLATED_NOT_ISSUED' || issueStatus === 'AWAITING_PLATE';
                // SIL-957 (K4.35) — the batch-release gate hoisted to ROW
                // scope: a row the batch cannot release dims as a whole and
                // prints its reason as text on the row (the checkbox tooltip
                // alone hid the wall between tickable and dead rows).
                const bulkGate = onToggleBulkSelection ? bulkIssueEligibility(row) : null;
                const bulkBlocked = bulkGate != null && !bulkGate.eligible;
                // Schedule law (cards 20261003_304 / 20261002_269 /
                // 20261003_318) — one shared derivation for table + card
                // (DispatchPlanCellValues.detailedScheduleLine).
                const scheduleValue = detailedScheduleLine(row);
                // SIL-793 — the schedule column prints the row's container
                // demand ("1 x 20DC") exactly like /dispatch's LỊCH TRÌNH
                // sub line; an LCL lot renders nothing (no container owned).
                const demandLine = detailedDemandLine(row);
                const differentTransportDate = row.time.runAt && row.time.deliveryDate && formatISODate(row.time.runAt) !== formatISODate(row.time.deliveryDate) ? formatISODate(row.time.deliveryDate) : null;
                return (
                <tr key={detailRowKey(row)} className={`detailed-plan-grid__row${row.lotFullyPlated ? ' detailed-plan-grid__row--plated' : ''}${bulkBlocked ? ' detailed-plan-grid__row--bulk-blocked' : ''}`}>
                  {onToggleQuickAssignSelection ? (() => {
                    const rowKey = detailRowKey(row);
                    const assignable = row.taskStatus !== 'COMPLETED'
                      && (row.dispatch.tripId == null || row.dispatch.tripStatus === 'CANCELED');
                    return (
                      <td className="detailed-plan-grid__cell detailed-plan-grid__cell--select" data-label="Gán xe" data-label-short="Gán">
                        <div className="detailed-plan-grid__cell-body detailed-plan-grid__cell-body--select">
                          <LclSelectCheckbox
                            isSelected={selectedQuickAssignKeys?.has(rowKey) ?? false}
                            // HOT-04 + the editor's LCL law: an LCL group owns ONE
                            // shared plate managed group-wide ('Đổi BKS nhóm') — a
                            // per-row quick assign would silently split the group's
                            // BKS, so group members are not selectable here.
                            isDisabled={!assignable || (row.cargoMode === 'LCL' && costGroupOf(row.lcl?.group) != null)}
                            onToggle={(next: boolean) => onToggleQuickAssignSelection(rowKey, next, row)}
                            ariaLabel={`Chọn gán xe lô ${billBookingReference(row.docs.billNumber)}`}
                            title={assignable
                              ? 'Chọn dòng để gán nhà xe nhanh'
                              : 'Dòng đã phát lệnh hoặc đã hoàn thành — không gán nhanh được.'}
                          />
                        </div>
                      </td>
                    );
                  })() : onToggleBulkSelection ? (
                    /* SIL-884 (5.1) — the batch-release column: only 'Đã điều
                       xe' (or deferred-plate external) rows without a lệnh are
                       tickable; every other row explains itself inline. The
                       checkbox never goes natively disabled without a title —
                       a control that can't say why is the loop QA reported. */
                    <td className="detailed-plan-grid__cell detailed-plan-grid__cell--select" data-label="Phát lệnh" data-label-short="Phát">
                      <div className="detailed-plan-grid__cell-body detailed-plan-grid__cell-body--select">
                        <LclSelectCheckbox
                          isSelected={selectedBulkFulfillmentIds?.has(row.fulfillmentId) ?? false}
                          isDisabled={!bulkGate?.eligible}
                          onToggle={(next: boolean) => onToggleBulkSelection(row.fulfillmentId, next, row)}
                          ariaLabel={`Chọn phát lệnh lô ${billBookingReference(row.docs.billNumber)}`}
                          title={bulkGate?.eligible
                            ? 'Đã điều xe, chưa phát lệnh — phát theo điều phối đã lưu.'
                            : bulkGate?.reason ?? 'Không đủ điều kiện phát lệnh hàng loạt.'}
                        />
                      </div>
                    </td>
                  ) : onToggleLclSelection && (
                    <td className="detailed-plan-grid__cell detailed-plan-grid__cell--select" data-label="Chọn" data-label-short="Chọn">
                      <div className="detailed-plan-grid__cell-body detailed-plan-grid__cell-body--select">
                        {/* Spec 23/10 §2: only LCL rows are tickable (FCL stays
                            dimmed so a dispatcher cannot merge cont rows);
                            master-plan law — a lot already in a cost group is
                            refused until tách nhóm (the server 409s the same
                            way). */}
                        {row.cargoMode === 'LCL' ? (
                          <LclSelectCheckbox
                            isSelected={selectedLclShipmentIds?.has(row.shipmentId) ?? false}
                            isDisabled={costGroupOf(row.lcl?.group) != null}
                            onToggle={(next: boolean) => onToggleLclSelection(row.shipmentId, next)}
                            ariaLabel={`Chọn lô ${billBookingReference(row.docs.billNumber)}`}
                            title={costGroupOf(row.lcl?.group) != null
                              ? 'Lô đã thuộc nhóm ghép — tách nhóm trước khi ghép lại.'
                              : 'Chọn lô này để gán xe nhóm'}
                          />
                        ) : (
                          <LclSelectCheckbox
                            isSelected={false}
                            isDisabled
                            onToggle={() => {}}
                            ariaLabel={`Lô cont ${row.container.containerNumber ?? ''} không tham gia gộp hàng`}
                            title="Chỉ ghép lô hàng lẻ (LCL) — dòng cont không tích được."
                          />
                        )}
                      </div>
                    </td>
                  )}
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--schedule" data-label="Thời gian & lịch trình" data-label-short="Giờ">
                    {/* FB-043: every cell rides the fixed-height body so row
                        height is uniform by construction, not by column
                        tuning (the R22/141026001010 regression class). */}
                    <div className="detailed-plan-grid__cell-body">
                      <div className="ops-schedule">
                        <strong className="ops-schedule__datetime" title={scheduleValue}>{scheduleValue}</strong>
                        {demandLine && (
                          <span
                            className="detailed-plan-grid__line detailed-plan-grid__line--muted detailed-plan-grid__demand-line"
                            title={demandLine}
                          >
                            {demandLine}
                          </span>
                        )}
                        <span className="detailed-plan-grid__line detailed-plan-grid__line--muted" data-empty={!row.docs.tradeDirection ? 'true' : undefined} title={row.docs.tradeDirection || differentTransportDate ? `${row.docs.tradeDirection === 'IMPORT' ? 'trả hàng' : row.docs.tradeDirection === 'EXPORT' ? 'đóng hàng' : ''}${differentTransportDate ? ` · Ngày vận chuyển: ${differentTransportDate}` : ''}` : undefined}>
                          {row.docs.tradeDirection === 'IMPORT' ? 'trả hàng' : row.docs.tradeDirection === 'EXPORT' ? 'đóng hàng' : '—'}
                          {differentTransportDate && ` · Ngày vận chuyển: ${differentTransportDate}`}
                        </span>
                      </div>
                    </div>
                    {bulkBlocked && (
                      <span className="detailed-plan-grid__bulk-reason">{bulkGate?.reason}</span>
                    )}
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--route" data-label="Khách hàng & lộ trình" data-label-short="Khách">
                    <div className="detailed-plan-grid__cell-body">
                      <div className="detailed-plan-grid__line detailed-plan-grid__line--strong">
                        {row.customerRoute.customerName
                          ? <NameCell name={row.customerRoute.customerName} />
                          : '—'}
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
                          <div className="detailed-plan-grid__line detailed-plan-grid__line--strong"><NameCell name={row.customerRoute.routeName} /></div>
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
                  {/* SIL-1191 — the Điều phối cell rides before the container
                      metadata, matching the colgroup/thead order: left of the
                      THAO TÁC rail's fold at the 1440 canvas so the five
                      dispatch facts read whole without scrolling (KB
                      §10.3.3). */}
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--editable" data-label="Điều phối" data-label-short="Điều phối">
                    <DispatchPlanEditorCell
                      row={row}
                      onAtomicSave={onAtomicSave}
                      onCancelDispatch={onCancelDispatch}
                      onEnsureFulfillment={onEnsureFulfillment}
                      autoOpenFulfillmentId={autoOpenFulfillmentId}
                      onAutoOpenConsumed={onAutoOpenConsumed}
                      onCompleteExternalTrip={onCompleteExternalTrip}
                      onIssueOrder={onIssueOrder}
                      onChangeGroupTruck={onChangeGroupTruck}
                      openRequest={editRequest?.key === detailRowKey(row) ? editRequest : null}
                      onOpenRequestConsumed={consumeEditRequest}
                    />
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--container" data-label="Container" data-label-short="Cont">
                    <div className="detailed-plan-grid__cell-body">
                      {row.cargoMode === 'FCL' ? (
                        <>
                          {/* SIL-653 (id 760) — SỐ CONT click-to-edit inline
                              (same cell model as SỐ TỜ KHAI): the save goes
                              through the CUS container-line command and the
                              backend bridge mirrors it onto the trip
                              snapshot, so dispatch/CUS/driver stay in lockstep. */}
                          <DispatchContainerNumberCell row={row} onSaved={onRowsChanged} />
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
                            Lẻ{costGroupOf(row.lcl?.group)?.vehicleClassCode ? ` · Xe ${costGroupOf(row.lcl?.group)?.vehicleClassCode}` : ''}
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
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--declaration" data-label="Số tờ khai" data-label-short="Tờ khai">
                    <DispatchDeclarationCell row={row} onSaved={onRowsChanged} />
                  </td>
                  {/* K2.31 (SIL-934) — Moóc: the run's assigned trailer plate
                      (live trip) or the planned OWN tractor's coupling, with
                      its type on a muted line; '—' when the row owns none. */}
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--trailer" data-label="Moóc" data-label-short="Moóc">
                    <div className="detailed-plan-grid__cell-body">
                      <div className="detailed-plan-grid__line" data-empty={!row.dispatch.assignedTrailerPlate ? 'true' : undefined}>
                        {row.dispatch.assignedTrailerPlate ?? '—'}
                      </div>
                      {row.dispatch.assignedTrailerPlate && row.dispatch.assignedTrailerType && (
                        <div className="detailed-plan-grid__line detailed-plan-grid__line--muted">
                          {row.dispatch.assignedTrailerType}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--classification" data-label="Phân loại" data-label-short="Loại">
                    <div className="detailed-plan-grid__cell-body detailed-plan-grid__cell-body--row">
                      {(() => {
                        const rowKey = detailRowKey(row);
                        const classificationOptions = classificationOptionsForRow(row.cargoMode)
                          .filter((opt) => opt.value === 'SINGLE' || opt.value === 'DOUBLE' || opt.value === 'COMBINED');
                        const canEdit = row.taskStatus !== 'COMPLETED' && classificationOptions.length > 1;
                        const isEditing = editingClassificationKey === rowKey;
                        const displayedClassification = optimisticClassifications[rowKey] ?? row.classification;

                        if (isEditing) {
                          return (
                            <UuiSelectField
                              label={`Phân loại ${row.container.containerNumber || row.shipmentCode || ''}`}
                              hideLabel
                              size="sm"
                              width="content"
                              controlClassName="detailed-plan-grid__classification-select"
                              value={displayedClassification}
                              disabled={savingClassificationKey === rowKey}
                              options={classificationOptions}
                              onChange={(e) => {
                                void handleInlineClassificationSave(row, e.target.value as DispatchClassification);
                              }}
                            />
                          );
                        }

                        if (canEdit) {
                          return (
                            <button
                              type="button"
                              className="detailed-plan-grid__classification"
                              onClick={() => {
                                setInlineClassificationError(null);
                                setEditingClassificationKey(rowKey);
                              }}
                              aria-label={`Sửa phân loại · ${DISPATCH_CLASSIFICATION_LABELS[displayedClassification]}`}
                              title="Bấm để sửa phân loại"
                            >
                              {DISPATCH_CLASSIFICATION_LABELS[displayedClassification]}
                            </button>
                          );
                        }

                        return (
                          <span className="detailed-plan-grid__classification">
                            {DISPATCH_CLASSIFICATION_LABELS[displayedClassification]}
                          </span>
                        );
                      })()}
                      {/* FB-095 — with the page wired, the COST badge is the
                          group's action surface (Xem nhóm / Hủy ghép); unwired
                          it stays a static tag exactly like the pre-FB-095
                          badge. SIL-1166: a REV group (Gộp hàng) is
                          display-only here — static tag, never the cost
                          verbs. */}
                      {/* SIL-589 (owner 27/10): ONE kind word per row — the
                          classification above already says "Lẻ", so the group
                          tag carries ONLY the group position, exactly the copy
                          the phone card (issue #13) already uses.
                          K3.79/K4.31 (SIL-1166): the merged row's cell reads
                          the chip format "Lẻ · Ghép (k/N)" — the " · " joins
                          the two labels; the tag itself never repeats "Lẻ".
                          No pill chrome: §1 text-only (the old oval
                          border-radius:999px tag wrapped vertically and
                          overflowed the column). */}
                      {row.cargoMode === 'LCL' && row.lcl?.group && (() => {
                        const group = row.lcl.group;
                        const tag = `Ghép (${group.order ?? '?'}/${group.memberCount ?? '?'})`;
                        return (
                          <>
                            {' · '}
                            {group.dimension === 'REV' || !onUnmergeLclLot ? (
                              <span
                                className="detailed-plan-grid__lcl-group-tag"
                                title={lclGroupTagTitle(group)}
                              >
                                {tag}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="detailed-plan-grid__lcl-group-tag detailed-plan-grid__lcl-group-tag--action"
                                title={lclGroupTagTitle(group)}
                                onClick={() => setGroupMenuRow(row)}
                              >
                                {tag}
                              </button>
                            )}
                          </>
                        );
                      })()}
                      {/* Owner redesign 23/10 — "Tách nhóm" (SPEC 18/10/2026 §4,
                          Lô 1 only) and "Ghép chuyến" (LoHangKepKetHop §3.1)
                          moved into the row ⋯ menu: this cell is data-only. */}
                    </div>
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--notes" data-label="Ghi chú" data-label-short="Ghi chú">
                    {/* Notes only (owner redesign 23/10): the actions moved to
                        the pinned Thao tác column, so nothing here can cover a
                        note again. Long notes clamp; the full text is one
                        click away in the dialog. */}
                    <div className="detailed-plan-grid__cell-body detailed-plan-grid__cell-body--notes">
                      <div className="detailed-plan-grid__note-stack">
                        {row.notes.vehicleNote && (
                          <div className="detailed-plan-grid__note-entry">
                            <button
                              type="button"
                              className="detailed-plan-grid__note"
                              onClick={() => setExpandedNote({ title: 'Ghi chú xe', text: row.notes.vehicleNote ?? '', driver: true })}
                              title="Bấm để xem toàn bộ ghi chú"
                            >
                              <DispatchDriverNote value={row.notes.vehicleNote} labels={taskLabels} compact />
                            </button>
                            {isNoteLong(row.notes.vehicleNote, 28) && (
                              <button
                                type="button"
                                className="detailed-plan-grid__note-detail-trigger"
                                aria-label="Xem chi tiết ghi chú xe"
                                onClick={() => setExpandedNote({ title: 'Ghi chú xe', text: row.notes.vehicleNote ?? '', driver: true })}
                              >
                                Chi tiết
                              </button>
                            )}
                          </div>
                        )}
                        {row.notes.opsRecoveryNotes?.map((note, idx) => (
                          <div key={`${idx}-${note}`} className="detailed-plan-grid__note-entry">
                            <button
                              type="button"
                              className="detailed-plan-grid__note"
                              onClick={() => setExpandedNote({ title: 'Ghi chú OPS', text: note })}
                            >
                              <span className="detailed-plan-grid__line detailed-plan-grid__note-preview" style={{ whiteSpace: 'pre-wrap' }}>
                                <strong>OPS: </strong>{note}
                              </span>
                            </button>
                            {isNoteLong(`OPS: ${note}`, 28) && (
                              <button
                                type="button"
                                className="detailed-plan-grid__note-detail-trigger"
                                aria-label="Xem chi tiết ghi chú OPS"
                                onClick={() => setExpandedNote({ title: 'Ghi chú OPS', text: note })}
                              >
                                Chi tiết
                              </button>
                            )}
                          </div>
                        ))}
                        {row.notes.customerNote && (() => {
                          const formattedCustomerNote = displayNote(row.notes.customerNote);
                          return (
                            <div className="detailed-plan-grid__note-entry">
                              <button
                                type="button"
                                className="detailed-plan-grid__note"
                                onClick={() => setExpandedNote({ title: 'Ghi chú khách hàng', text: formattedCustomerNote })}
                                title="Bấm để xem toàn bộ ghi chú"
                              >
                                <span className="detailed-plan-grid__line detailed-plan-grid__line--muted detailed-plan-grid__note-preview">
                                  {`Khách: ${formattedCustomerNote}`.split('\n').map((line, i) => (
                                    <span key={i} className="detailed-plan-grid__note-line">{line}</span>
                                  ))}
                                </span>
                              </button>
                              {isNoteLong(`Khách: ${formattedCustomerNote}`, 28) && (
                                <button
                                  type="button"
                                  className="detailed-plan-grid__note-detail-trigger"
                                  aria-label="Xem chi tiết ghi chú khách hàng"
                                  onClick={() => setExpandedNote({ title: 'Ghi chú khách hàng', text: formattedCustomerNote })}
                                >
                                  Chi tiết
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </td>
                  {/* SIL-588 (owner 27/10, supersedes the SIL-519 one-line
                      rail): the ONE pinned action column holds at most TWO
                      stacked buttons — the compact primary (Phát lệnh icon)
                      on top, the ⋯ menu below. "Hoàn thành" lives INSIDE the
                      ⋯ menu (DispatchRowActionsMenu item), so the rail
                      narrows to its buttons instead of hosting a full-text
                      pill. Sticky right so it never scrolls away. */}
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--actions" data-label="Thao tác">
                    <div className="detailed-plan-grid__row-actions">
                      {canQuickIssue && <QuickIssueOrderButton row={row} onIssueOrder={handleQuickIssueOrder} />}
                      <DispatchRowActionsMenu
                        row={row}
                        onEditPlan={requestEditPlan}
                        onChangeVehicle={requestChangeVehicle}
                        onChangeGroupTruckInline={openGroupTruckEdit}
                        onAddLotsToGroup={onAddLotsToGroup}
                        onCancelDispatch={onCancelDispatch}
                        onUpdateExternalPlate={onUpdateExternalPlate}
                        onOpenPair={onOpenPair}
                        onUnmergeLclGroup={onUnmergeLclGroup}
                        onUnpairTrip={onUnpairTrip}
                        onDeleteLot={onDeleteLot}
                        onCompleteExternalTrip={onCompleteExternalTrip}
                        onStartLclMerge={onStartLclMerge}
                      />
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          )}
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
                    if (!actual) {
                      setGroupTruckError('Nhập BKS thực');
                      return;
                    }
                    if (actual === (group.actualTruckNo ?? '')) {
                      setGroupTruckError('Chưa có gì thay đổi — sửa BKS thực trước khi lưu.');
                      return;
                    }
                    setSavingGroupTruck(true);
                    setGroupTruckError(null);
                    // GP-03 — only BKS thực rides the ĐV write.
                    void updateLclTruck({
                      shipmentId: groupMenuRow.shipmentId,
                      actualTruckNo: actual,
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
                {/* GP-03 (spec 23/10 §1) — only BKS thực: the whole group
                    follows this plate; "BKS báo khách" is a CUS-side output
                    and no longer renders in any ĐV edit. */}
                <TextField
                  id="lcl-group-truck-actual"
                  label="BKS thực (cả nhóm ghép)"
                  autoComplete="off"
                  value={groupTruckDraft.actual}
                  onChange={(event) => setGroupTruckDraft((current) => (current == null ? current : { ...current, actual: event.target.value }))}
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
                {/* SIL-538 — Tách nhóm joins the tag popover so the whole-group
                    unmerge is direct on the Lô 1 row (same law as the ⋯ menu
                    entry it mirrors: SPEC 18/10/2026 §4, Lô 1 only). */}
                {onUnmergeLclGroup && groupMenuRow.lcl.group.order === 1 && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    title="Tách nhóm ghép — mỗi lô trở về cước trả ĐV độc lập"
                    onClick={() => {
                      onUnmergeLclGroup(groupMenuRow.lcl!.group!.groupId);
                      setGroupMenuRow(null);
                    }}
                  >
                    Tách nhóm
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </Modal>

    </>
  );
}
