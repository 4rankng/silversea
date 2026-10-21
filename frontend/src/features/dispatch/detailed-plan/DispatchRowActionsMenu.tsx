import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Repeat, Shuffle } from 'lucide-react';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { useDropdownDismiss } from '../../../hooks/useDropdownDismiss';
import { billBookingReference } from '../../../lib/business-reference';

/** Menu geometry — fixed-positioned at body level so no table-cell clipping
 *  (`.detailed-plan-grid__cell-body` is a shared overflow:hidden band) can
 *  hide the actions from the dispatcher. */
const MENU_WIDTH = 200;
const MENU_GAP = 6;
const VIEWPORT_PADDING = 8;

/**
 * DIS-09 (card 211026130015) — the "Đổi nhà xe/BKS" action for assigned tasks
 * was buried behind the Phân loại badge (badge → modal → button). This row
 * menu (⋯ dropdown) surfaces it ONE click from the row: the grouped LCL item
 * opens the same pre-filled group-truck edit the badge modal owns, and an
 * issued task additionally carries "Phân xe lại" (the governed trip
 * reassignment dialog) so every assigned row has its truck-change affordance
 * on the row itself.
 *
 * React-state dropdown on the house dismissal layer (useDropdownDismiss +
 * `data-dropdown-root`, the CustomersConfigPage/TripHeader contract): outside
 * press and Escape close it, overlay-registered so the app-level Escape
 * "go back" yields while the menu is up. The list renders through a body
 * portal in FIXED viewport coordinates — table cells clip absolute
 * dropdowns, which would reopen exactly the "action invisible" defect this
 * card fixes. Hidden unless the row actually owns one of the actions: an
 * assigned task (a carrier is on the plan) that is not completed history.
 */
export function DispatchRowActionsMenu({ row, onChangeGroupTruckInline, onOpenTripReassign }: {
  row: DispatchDetailPlanRow;
  /** Opens the grid's pre-filled "Đổi nhà xe/BKS" group-truck edit (grouped LCL). */
  onChangeGroupTruckInline: (row: DispatchDetailPlanRow) => void;
  /** Opens the page-owned trip reassignment dialog (issued trips). */
  onOpenTripReassign: (tripId: number) => void;
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

  // Completed rows are frozen history and carrier-less rows own no truck to
  // change — no menu, no dead trigger.
  if (row.taskStatus === 'COMPLETED' || row.dispatch.carrierType == null
    || (!lclGroup && !canReassignIssuedTrip)) {
    return null;
  }

  const identity = row.container.containerNumber?.trim() || billBookingReference(row.docs.billNumber);
  const itemCount = (lclGroup ? 1 : 0) + (canReassignIssuedTrip && row.dispatch.tripId != null ? 1 : 0);
  const menuHeight = itemCount > 1 ? 92 : 50;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const left = Math.max(VIEWPORT_PADDING, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING));
        const below = rect.bottom + MENU_GAP;
        // Not enough room below the row (viewport bottom) → open upward.
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
      aria-label={`Thao tác dòng · ${identity}`}
      data-dropdown-root=""
      style={{ position: 'fixed', top: placement.top, left: placement.left, width: MENU_WIDTH }}
    >
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
      {canReassignIssuedTrip && row.dispatch.tripId != null && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onOpenTripReassign(row.dispatch.tripId!);
          }}
        >
          <Shuffle size={14} aria-hidden="true" />
          Phân xe lại
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
        aria-label={`Thao tác dòng · ${identity}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Thao tác dòng"
        onClick={toggle}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
}
