import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Layers, Link2, MoreHorizontal, PencilLine, Repeat, Trash2, Truck, Undo2, Unlink } from 'lucide-react';
import { costGroupOf, type DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { useDropdownDismiss } from '../../../hooks/useDropdownDismiss';
import { billBookingReference } from '../../../lib/business-reference';
import { canReassignIssuedTrip, detailRowKey } from './DispatchPlanCellValues';

/** Issue #13 (card 3-dòng) — a card-body tap opens this menu without the
 *  ⋯ trigger (unissued cards show the paper-plane slot instead). The anchor
 *  rect is captured at tap time: the portalled list is fixed-positioned, so
 *  click-time viewport coordinates are the correct geometry. */
export interface RowMenuOpenRequest {
  key: string;
  nonce: number;
  anchorRect?: { top: number; left: number; right: number; bottom: number } | null;
}

/** Menu geometry — fixed-positioned at body level so no table-cell clipping
 *  (`.detailed-plan-grid__cell-body` is a shared overflow:hidden band) can
 *  hide the actions from the dispatcher. */
const MENU_MIN_WIDTH = 156;
const MENU_MAX_WIDTH = 224;
const MENU_GAP = 4;
const VIEWPORT_PADDING = 8;
const MENU_ITEM_H = 32;
const MENU_DANGER_BLOCK_H = 40;

/**
 * DIS-09 (card 211026130015) + owner redesign 23/10 — the ONE row action
 * surface of the detailed-plan grid. Every per-row verb that used to render
 * as a scattered inline button (Sửa in the Điều phối cell, Ghép + Tách nhóm
 * in Phân loại, Xóa lô ĐỎ under Ghi chú) lives in this single ⋯ dropdown so
 * the data cells stay text-only (design law §1) and no button ever covers a
 * value:
 *
 * - "Sửa điều phối" (or "Hủy phân xe" on a live issued trip — SIL-708
 *   replaced Phân xe lại with the cancel-then-reassign flow) on EVERY
 *   non-completed row, including unassigned ones (assigning is the menu's
 *   most common verb).
 * - "Đổi nhà xe/BKS" on grouped LCL rows — opens the same pre-filled
 *   group-truck edit the badge modal owns.
 * - "Ghép chuyến" on pairable rows (the DispatchPairAction law).
 * - "Tách nhóm" on Lô 1 of a COST group (SPEC 18/10/2026 §4).
 * - "Xóa lô" LAST, in the danger voice, behind its own confirm (the page
 *   owns the CUS/ADMIN role law — cards 351/352 + 20261007_396).
 *
 * React-state dropdown on the house dismissal layer (useDropdownDismiss +
 * `data-dropdown-root`): outside press and Escape close it, overlay-
 * registered so the app-level Escape "go back" yields while the menu is up.
 * The list renders through a body portal in FIXED viewport coordinates —
 * table cells clip absolute dropdowns. Completed rows are frozen history:
 * no menu at all.
 *
 * Issue #13 (card 3-dòng, owner + Gemini consult 23/10 tối): the phone card's
 * single-action slot drives this menu two ways — the visible ⋯ trigger
 * (issued/unassigned cards), or `triggerless` + `openRequest` when the slot
 * shows the paper-plane instead (unissued cards open the same menu by
 * tapping the card's 3-line info block). "Hoàn thành" rides the menu for
 * external live trips so the old foot button could be removed without
 * losing the staff close flow.
 */
export function DispatchRowActionsMenu({ row, onEditPlan, onChangeGroupTruckInline, onAddLotsToGroup, onCancelDispatch, onUpdateExternalPlate, onOpenPair, onUnmergeLclGroup, onUnpairTrip, onDeleteLot, onCompleteExternalTrip, onStartLclMerge, onChangeVehicle, triggerless = false, openRequest, onOpenRequestConsumed }: {
  row: DispatchDetailPlanRow;
  /** Opens the row's plan editor (the grid routes it to the cell's signal). */
  onEditPlan: (row: DispatchDetailPlanRow) => void;
  /** Opens the grid's pre-filled "Đổi nhà xe/BKS" group-truck edit (grouped LCL). */
  onChangeGroupTruckInline: (row: DispatchDetailPlanRow) => void;
  /** CR-011.2 Q8 — "Thêm lô vào nhóm" on a grouped LCL row: the page owns
   *  the eligible-lot dialog + the refetch (same wiring law as Đổi BKS). */
  onAddLotsToGroup?: (row: DispatchDetailPlanRow) => void;
  /** SIL-708 — Hủy phân xe flow for live issued trips (replaces Phân xe lại). */
  onCancelDispatch?: (row: DispatchDetailPlanRow) => void;
  /** SIL-714 — Cập nhật biển số for a live EXTERNAL trip awaiting its plate. */
  onUpdateExternalPlate?: (row: DispatchDetailPlanRow) => void;
  /** Opens the pair-trips dialog anchored on this row (optional — parity
   *  with the old DispatchPairAction wiring). */
  onOpenPair?: (row: DispatchDetailPlanRow) => void;
  /** SPEC 18/10/2026 §4 — dissolves the whole COST group (Lô 1 only). */
  onUnmergeLclGroup?: (groupId: string) => void;
  /** SIL-1021 (KB Ch.3 §3.5 K3.50) — Hủy ghép cặp chuyến on a row whose
   *  ACTIVE pair links it (pairKind set): both legs return to Đơn from one
   *  action; the page owns the confirm + API call. */
  onUnpairTrip?: (row: DispatchDetailPlanRow) => void;
  /** Card 211026005623 — the page's delete flow (confirm + lý do + role law). */
  onDeleteLot?: (row: DispatchDetailPlanRow) => void;
  /** Issue #13 (card 3-dòng) — external live trips close from the menu on
   *  the phone card (the single-action slot replaces the old foot button);
   *  external drivers don't use the app, so this surface is the only one
   *  that can complete their trips (feedback 2026-09-08). */
  onCompleteExternalTrip?: (row: DispatchDetailPlanRow) => void;
  /** SIL-590 (id 690) — the row ⋯ menu's "Gộp hàng": enters the page's
   *  on-demand merge mode with THIS row pre-picked, so gộp hàng lẻ happens
   *  in place on Kế hoạch Chi tiết (never a navigation to Kế hoạch Tổng
   *  quát — the old build's defect the customer reported). Ungrouped LCL
   *  rows only; absent while the merge mode is already active (the CHỌN
   *  checkboxes own that state). */
  onStartLclMerge?: (row: DispatchDetailPlanRow) => void;
  /** Issue #13 — render no ⋯ trigger (the card's single-action law: the slot
   *  shows the paper-plane instead); the menu still mounts so the card-body
   *  signal can open it. */
  triggerless?: boolean;
  /** DIS-10 / K4.19 (SIL-955) — 'Đổi nhà xe/BKS' on an assigned row whose
   *  trip is still CREATED: opens the governed Chỉnh sửa điều phối dialog
   *  (the plan save is legal pre-departure; the backend blocks only
   *  non-CREATED live trips). Absent → no entry. */
  onChangeVehicle?: (row: DispatchDetailPlanRow) => void;
  /** Card-body tap signal (same nonce pattern the editor cell consumes). */
  openRequest?: RowMenuOpenRequest | null;
  /** Clears the caller's pending signal once consumed. */
  onOpenRequestConsumed?: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Placement in viewport coordinates, measured at open — a scrolled/stacked
  // grid re-measures on every open.
  const [placement, setPlacement] = useState<{ top: number; right: number } | null>(null);
  useDropdownDismiss(open, () => setOpen(false));

  // SIL-1166 — cost-side group only: a rev group (Gộp hàng) riding lcl.group
  // is display-only on this board, so every verb here keys off the COST group
  // exactly as before the rev facts rode the wire.
  const lclGroup = row.cargoMode === 'LCL' ? costGroupOf(row.lcl?.group) : null;
  // Same live-trip law as the editor trigger (DispatchPlanEditorCell): a
  // reassignment before departure goes through the governed dialog.
  const canReassignIssued = canReassignIssuedTrip(row);
  // DIS-10 / K4.19 (SIL-955, QA 24/11): the ⋯ menu of an ASSIGNED row
  // carries the KB's vehicle verb 'Đổi nhà xe/BKS' (KB §4.1.3 / §10.3.5 —
  // đổi nhà xe/BKS qua menu ⋯ trên dòng đã gán xe).
  //
  // VÒNG 2 — why the round-1 gate missed QA's own repro row: it asked for
  // tripStatus === 'CREATED', but QA's row (RTAU8980074) is 'Đã điều xe',
  // CHƯA phát lệnh — it owns NO trip, so its menu carried only 'Sửa điều phối'.
  // That is exactly the row where the change is LEGAL: the plan save is
  // refused only for a LIVE trip (the backend's live-trip guard), so the
  // verb belongs on the rows whose plan is still editable.
  //
  // SIL-1236 (KB §2.3.5) — a row that owns a LIVE trip carries the verb
  // again: the backend no longer blanket-refuses issued rows, so the
  // governed editor IS the entry (pre-acceptance the save is a full
  // re-assignment synced onto the trip; after ORDER_RECEIVED the dialog
  // locks the carrier dimension and the backend enforces vehicle-only).
  // 'Hủy phân xe' stays alongside, unchanged (SIL-708).
  //
  // Grouped LCL rows already own their Đổi nhà xe/BKS item (the group-truck
  // edit) — this entry stays off them.
  const planEditable = row.dispatch.tripId == null || row.dispatch.tripStatus === 'CANCELED';
  const vehicleAssigned = row.dispatch.carrierName != null;
  const canChangeVehicle = onChangeVehicle != null
    && (planEditable || canReassignIssued)
    && vehicleAssigned
    && lclGroup == null;
  // SIL-708: a planned-but-unissued row with an assigned carrier can also
  // unassign directly from the ⋯ menu (clearing plannedCarrierType + plate).
  // SIL-1126: grouped LCL rows carry it too — the cancel releases THIS
  // fulfillment only (the same per-row law as the trip-cancel release,
  // SIL-753); the group's shared BKS stays governed by "Đổi BKS nhóm".
  const canUnassignPlanned = !canReassignIssued
    && onCancelDispatch != null
    && planEditable
    && vehicleAssigned;
  // DispatchPairAction law (LoHangKepKetHop §3.1): unpaired OWN-carrier row
  // that already has a trip.
  const canPair = onOpenPair != null
    && row.dispatch?.tripId != null
    && row.dispatch.carrierType !== 'EXTERNAL'
    && !row.dispatch.pairKind
    && row.dispatch.tripStatus !== 'CANCELED';
  const canUnmergeGroup = onUnmergeLclGroup != null && lclGroup != null && lclGroup.order === 1;
  // SIL-1021 (KB Ch.3 §3.5 K3.50) — a row riding an ACTIVE pair (pairKind
  // set; the read service yields it only for ACTIVE) carries Hủy ghép. The
  // paired row never shows Ghép chuyến (canPair demands !pairKind), so the
  // two verbs never share a menu.
  const canUnpair = onUnpairTrip != null
    && row.dispatch.activePairId != null
    && row.dispatch.pairKind != null;
  // SIL-590 (id 690) — gộp hàng phải chạy TẠI màn hình chi tiết: ungrouped
  // hàng-lẻ rows carry the in-place merge entry (a grouped row's group verbs
  // are Đổi nhà xe/BKS + Tách nhóm, and FB-095 refuses re-merge while
  // grouped). The handler is absent while the merge mode is already active —
  // the CHỌN checkboxes own that state.
  const canStartLclMerge = onStartLclMerge != null
    && row.cargoMode === 'LCL'
    // SIL-1166 — the cost-aware read: a rev-only group never hid this verb
    // before it rode the wire, and must not start now.
    && lclGroup == null;
  // Same live-trip law as the editor trigger: an external live trip closes
  // from the menu (Hoàn thành) — external drivers don't use the app.
  const canCompleteExternal = onCompleteExternalTrip != null
    && row.dispatch.carrierType === 'EXTERNAL'
    && row.dispatch.tripId != null
    && row.taskStatus === 'DISPATCHED';
  // SIL-714 (Spec I.4e): a live EXTERNAL trip still waiting for its actual
  // plate gets the Cập nhật biển số entry (both Điều vận and CUS hold the
  // write). A plated trip corrects through Hủy phân xe + phân xe mới
  // (SIL-708) — the entry disappears once the plate is on the trip.
  const canUpdateExternalPlate = onUpdateExternalPlate != null
    && row.dispatch.carrierType === 'EXTERNAL'
    && row.dispatch.tripId != null
    && !row.dispatch.assignedPlate
    && canReassignIssuedTrip(row);

  const identity = row.container.containerNumber?.trim() || billBookingReference(row.docs.billNumber);
  const itemCount = 1 + (canChangeVehicle ? 1 : 0) + (canUnassignPlanned ? 1 : 0) + (canCompleteExternal ? 1 : 0) + (canUpdateExternalPlate ? 1 : 0) + (lclGroup ? 1 : 0) + (canPair ? 1 : 0) + (canUnpair ? 1 : 0) + (canStartLclMerge ? 1 : 0) + (canUnmergeGroup ? 1 : 0);
  const menuHeight = itemCount * MENU_ITEM_H + (onDeleteLot ? MENU_DANGER_BLOCK_H : 0) + 12;

  const placeAt = (anchor: { top: number; left: number; right: number; bottom: number } | null | undefined) => {
    if (!anchor) return;
    const right = Math.max(VIEWPORT_PADDING, Math.min(window.innerWidth - anchor.right, window.innerWidth - MENU_MIN_WIDTH - VIEWPORT_PADDING));
    const below = anchor.bottom + MENU_GAP;
    // Not enough room below the row (viewport bottom) → open upward.
    const top = below + menuHeight > window.innerHeight - VIEWPORT_PADDING
      ? Math.max(VIEWPORT_PADDING, anchor.top - MENU_GAP - menuHeight)
      : below;
    setPlacement({ top, right });
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      placeAt(triggerRef.current?.getBoundingClientRect());
    } else {
      setPlacement(null);
    }
  };

  // Issue #13 — the card body's tap signal opens the same menu the ⋯ trigger
  // owns (nonce-guarded, exactly the editor cell's openRequest pattern). It
  // must run before the completed early-return below: the hook count has to
  // stay constant across the row's lifecycle states.
  const openNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (openRequest == null || openRequest.nonce === openNonceRef.current) return;
    openNonceRef.current = openRequest.nonce;
    if (openRequest.key !== detailRowKey(row)) return;
    onOpenRequestConsumed?.();
    setOpen(true);
    placeAt(openRequest.anchorRect ?? triggerRef.current?.getBoundingClientRect());
  }, [openRequest, row, onOpenRequestConsumed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Completed rows are frozen history — no menu, no dead triggers.
  if (row.taskStatus === 'COMPLETED') {
    return null;
  }

  const menu = open && placement && (
    <div
      className="dispatch-row-menu__list"
      role="menu"
      aria-label={`Thao tác dòng · ${identity}`}
      data-dropdown-root=""
      style={{ position: 'fixed', top: placement.top, right: placement.right, minWidth: MENU_MIN_WIDTH, maxWidth: MENU_MAX_WIDTH }}
    >
      {canReassignIssued ? (
        <button
          type="button"
          role="menuitem"
          className="dispatch-row-menu__item--warn"
          onClick={() => {
            setOpen(false);
            if (onCancelDispatch) {
              onCancelDispatch(row);
            }
          }}
          title="Hủy phân xe để trả lô về trạng thái chưa phân xe"
        >
          <Undo2 size={14} aria-hidden="true" />
          Hủy phân xe
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onEditPlan(row);
          }}
        >
          <PencilLine size={14} aria-hidden="true" />
          Sửa điều phối
        </button>
      )}
      {canChangeVehicle && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onChangeVehicle?.(row);
          }}
          title="Đổi nhà xe / biển số — mở hộp thoại Chỉnh sửa điều phối tại ô Xe / biển số"
        >
          <Repeat size={14} aria-hidden="true" />
          Đổi nhà xe/BKS
        </button>
      )}
      {canUnassignPlanned && (
        <button
          type="button"
          role="menuitem"
          className="dispatch-row-menu__item--warn"
          onClick={() => {
            setOpen(false);
            onCancelDispatch?.(row);
          }}
          title="Hủy phân xe để trả lô về trạng thái chưa phân xe"
        >
          <Undo2 size={14} aria-hidden="true" />
          Hủy phân xe
        </button>
      )}
      {canUpdateExternalPlate && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onUpdateExternalPlate?.(row);
          }}
          title="Nhập biển số thực tế cho chuyến xe ngoài đang chờ biển (Điều vận và Chứng từ đều được sửa)"
        >
          <Truck size={14} aria-hidden="true" />
          Cập nhật biển số
        </button>
      )}
      {canCompleteExternal && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onCompleteExternalTrip(row);
          }}
          title="Hoàn thành chuyến với xe ngoài — xe ngoài không dùng app nên điều vận/CUS chốt thay"
        >
          <CheckCircle2 size={14} aria-hidden="true" />
          Hoàn thành
        </button>
      )}
      {lclGroup && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onChangeGroupTruckInline(row);
          }}
        >
          <Repeat size={14} aria-hidden="true" />
          Đổi nhà xe/BKS
        </button>
      )}
      {lclGroup && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onAddLotsToGroup?.(row);
          }}
          title="Thêm lô hàng lẻ chưa ghép vào nhóm này — cước trả của lô mới về 0₫, Lô 1 giữ 100%"
        >
          <Layers size={14} aria-hidden="true" />
          Thêm lô vào nhóm
        </button>
      )}
      {/* SIL-590 (id 690) — the merge verb ON THE ROW: entering the merge
          mode here pre-picks this lot and stays on the detail screen (the
          old build's "Gộp hàng" threw the dispatcher back to Kế hoạch Tổng
          quát). Grouped rows never see it — their verbs are Đổi nhà xe/BKS
          + Tách nhóm, and FB-095 refuses re-merge while grouped. */}
      {canStartLclMerge && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onStartLclMerge?.(row);
          }}
          title="Gộp lô này với lô hàng lẻ khác — tích thêm lô rồi Gán xe nhóm, ngay tại màn hình này"
        >
          <Layers size={14} aria-hidden="true" />
          Gộp hàng
        </button>
      )}
      {canPair && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onOpenPair?.(row);
          }}
        >
          <Link2 size={14} aria-hidden="true" />
          Ghép chuyến
        </button>
      )}
      {/* SIL-1021 (KB Ch.3 §3.5 K3.50) — Hủy ghép: the paired row's inverse
          verb. The page confirms, then POST /trips/pairs/:id/unpair — both
          legs return to Đơn, lịch xe/cước/lương cập nhật theo từng lệnh. */}
      {canUnpair && (
        <button
          type="button"
          role="menuitem"
          title="Hủy ghép cặp chuyến — 2 lệnh trở về Đơn, giữ nguyên lịch phân công hiện tại"
          onClick={() => {
            setOpen(false);
            onUnpairTrip?.(row);
          }}
        >
          <Unlink size={14} aria-hidden="true" />
          Hủy ghép
        </button>
      )}
      {canUnmergeGroup && lclGroup && (
        <button
          type="button"
          role="menuitem"
          title="Tách nhóm ghép — mỗi lô trở về cước trả ĐV độc lập"
          onClick={() => {
            setOpen(false);
            onUnmergeLclGroup?.(lclGroup.groupId);
          }}
        >
          <Unlink size={14} aria-hidden="true" />
          Tách nhóm
        </button>
      )}
      {/* Card 211026005623 — destructive action LAST, in the danger voice,
          visually separated: an accidental tap must cross the group's
          hairline and still meet the page's confirm + lý do dialog. */}
      {onDeleteLot && (
        <button
          type="button"
          role="menuitem"
          className="dispatch-row-menu__item--danger"
          onClick={() => {
            setOpen(false);
            onDeleteLot(row);
          }}
        >
          <Trash2 size={14} aria-hidden="true" />
          Xóa lô
        </button>
      )}
    </div>
  );

  return (
    <div className="dispatch-row-menu" data-dropdown-root={open ? '' : undefined}>
      {triggerless ? null : (
        <button
          ref={triggerRef}
          type="button"
          className="dispatch-row-menu__trigger"
          aria-label={`Thao tác dòng · ${identity}`}
          aria-haspopup="menu"
          aria-expanded={open}
          title={`Thao tác · ${identity}`}
          onClick={toggle}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      )}
      {menu && createPortal(menu, document.body)}
    </div>
  );
}
