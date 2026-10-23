import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Link2, MoreHorizontal, PencilLine, Repeat, Shuffle, Trash2, Unlink } from 'lucide-react';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { useDropdownDismiss } from '../../../hooks/useDropdownDismiss';
import { billBookingReference } from '../../../lib/business-reference';
import { detailRowKey } from './DispatchPlanCellValues';

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
const MENU_WIDTH = 216;
const MENU_GAP = 6;
const VIEWPORT_PADDING = 8;
const MENU_ITEM_H = 38;
const MENU_DANGER_BLOCK_H = 46;

/**
 * DIS-09 (card 211026130015) + owner redesign 23/10 — the ONE row action
 * surface of the detailed-plan grid. Every per-row verb that used to render
 * as a scattered inline button (Sửa in the Điều phối cell, Ghép + Tách nhóm
 * in Phân loại, Xóa lô ĐỎ under Ghi chú) lives in this single ⋯ dropdown so
 * the data cells stay text-only (design law §1) and no button ever covers a
 * value:
 *
 * - "Sửa điều phối" (or "Phân xe lại" on a live issued trip — the same
 *   reroute the old editor trigger owned) on EVERY non-completed row,
 *   including unassigned ones (assigning is the menu's most common verb).
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
export function DispatchRowActionsMenu({ row, onEditPlan, onChangeGroupTruckInline, onOpenTripReassign, onOpenPair, onUnmergeLclGroup, onDeleteLot, onCompleteExternalTrip, triggerless = false, openRequest, onOpenRequestConsumed }: {
  row: DispatchDetailPlanRow;
  /** Opens the row's plan editor (the grid routes it to the cell's signal). */
  onEditPlan: (row: DispatchDetailPlanRow) => void;
  /** Opens the grid's pre-filled "Đổi nhà xe/BKS" group-truck edit (grouped LCL). */
  onChangeGroupTruckInline: (row: DispatchDetailPlanRow) => void;
  /** Opens the page-owned trip reassignment dialog (issued trips). */
  onOpenTripReassign: (tripId: number) => void;
  /** Opens the pair-trips dialog anchored on this row (optional — parity
   *  with the old DispatchPairAction wiring). */
  onOpenPair?: (row: DispatchDetailPlanRow) => void;
  /** SPEC 18/10/2026 §4 — dissolves the whole COST group (Lô 1 only). */
  onUnmergeLclGroup?: (groupId: string) => void;
  /** Card 211026005623 — the page's delete flow (confirm + lý do + role law). */
  onDeleteLot?: (row: DispatchDetailPlanRow) => void;
  /** Issue #13 (card 3-dòng) — external live trips close from the menu on
   *  the phone card (the single-action slot replaces the old foot button);
   *  external drivers don't use the app, so this surface is the only one
   *  that can complete their trips (feedback 2026-09-08). */
  onCompleteExternalTrip?: (row: DispatchDetailPlanRow) => void;
  /** Issue #13 — render no ⋯ trigger (the card's single-action law: the slot
   *  shows the paper-plane instead); the menu still mounts so the card-body
   *  signal can open it. */
  triggerless?: boolean;
  /** Card-body tap signal (same nonce pattern the editor cell consumes). */
  openRequest?: RowMenuOpenRequest | null;
  /** Clears the caller's pending signal once consumed. */
  onOpenRequestConsumed?: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Placement in viewport coordinates, measured at open — a scrolled/stacked
  // grid re-measures on every open.
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null);
  useDropdownDismiss(open, () => setOpen(false));

  const lclGroup = row.cargoMode === 'LCL' ? row.lcl?.group ?? null : null;
  // Same live-trip law as the editor trigger (DispatchPlanEditorCell): a
  // reassignment before departure goes through the governed dialog.
  const canReassignIssuedTrip = row.taskStatus === 'DISPATCHED'
    && row.dispatch.tripId != null
    && (row.dispatch.tripStatus === 'CREATED' || row.dispatch.tripStatus === 'IN_TRANSIT');
  // DispatchPairAction law (LoHangKepKetHop §3.1): unpaired OWN-carrier row
  // that already has a trip.
  const canPair = onOpenPair != null
    && row.dispatch?.tripId != null
    && row.dispatch.carrierType !== 'EXTERNAL'
    && !row.dispatch.pairKind
    && row.dispatch.tripStatus !== 'CANCELED';
  const canUnmergeGroup = onUnmergeLclGroup != null && lclGroup != null && lclGroup.order === 1;
  const canCompleteExternal = onCompleteExternalTrip != null
    && row.dispatch.carrierType === 'EXTERNAL'
    && row.dispatch.tripId != null
    && row.taskStatus === 'DISPATCHED';

  const identity = row.container.containerNumber?.trim() || billBookingReference(row.docs.billNumber);
  const itemCount = 1 + (canCompleteExternal ? 1 : 0) + (lclGroup ? 1 : 0) + (canPair ? 1 : 0) + (canUnmergeGroup ? 1 : 0);
  const menuHeight = itemCount * MENU_ITEM_H + (onDeleteLot ? MENU_DANGER_BLOCK_H : 0) + 12;

  const placeAt = (anchor: { top: number; left: number; right: number; bottom: number } | null | undefined) => {
    if (!anchor) return;
    const left = Math.max(VIEWPORT_PADDING, Math.min(anchor.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING));
    const below = anchor.bottom + MENU_GAP;
    // Not enough room below the row (viewport bottom) → open upward.
    const top = below + menuHeight > window.innerHeight - VIEWPORT_PADDING
      ? Math.max(VIEWPORT_PADDING, anchor.top - MENU_GAP - menuHeight)
      : below;
    setPlacement({ top, left });
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
      style={{ position: 'fixed', top: placement.top, left: placement.left, width: MENU_WIDTH }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setOpen(false);
          if (canReassignIssuedTrip && row.dispatch.tripId != null) {
            onOpenTripReassign(row.dispatch.tripId);
          } else {
            onEditPlan(row);
          }
        }}
      >
        {canReassignIssuedTrip
          ? <><Shuffle size={14} aria-hidden="true" />Phân xe lại</>
          : <><PencilLine size={14} aria-hidden="true" />Sửa điều phối</>}
      </button>
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
