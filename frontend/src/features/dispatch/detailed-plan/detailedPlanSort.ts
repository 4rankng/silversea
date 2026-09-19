// Extracted from useDispatchDetailPlan.ts (card 20260918_D3, structural-debt
// recovery): the pure sort machinery of the detailed plan — the three-state
// header-sort transition and the row comparator. Zero behavior change; the
// verbatim semantics are pinned by DetailedPlanGrid / useDispatchDetailPlan
// suites (sorts-by-customer, run-hour ordering).
import type { DetailPlanSortDirection, DetailPlanSortKey } from './detailPlanFilters';

/** Structural minimum of a sortable row — keeps this module decoupled from
 *  the grid's row type while pinning the fields the comparator reads. The
 *  optional markers accept row types whose nullable fields are declared
 *  optional; the comparator coalesces. */
export interface DetailPlanSortableRow {
  time: { runAt?: string | null; runHour?: number | null };
  customerRoute: { customerName?: string | null; deliveryPoint?: string | null };
}

/** Three-state header sort transition: unsorted → ascending → descending →
 *  unsorted. Picking a different column restarts at ascending. */
export function nextDetailPlanSortState(
  sortKey: DetailPlanSortKey,
  sortDirection: DetailPlanSortDirection,
  key: Exclude<DetailPlanSortKey, null>,
): { sortKey: DetailPlanSortKey; sortDirection: DetailPlanSortDirection } {
  if (sortKey !== key) {
    return { sortKey: key, sortDirection: 'asc' };
  }
  if (sortDirection === 'asc') {
    return { sortKey, sortDirection: 'desc' };
  }
  return { sortKey: null, sortDirection: 'asc' };
}

/** Client-side comparator (spec: bundle trips by run time, dropoff point or
 *  customer). Run-time order follows the full runAt timestamp — minutes
 *  decide within the hour. Time-less rows sort LAST in both directions (an
 *  unknown time is never "before" a known one); runHour only breaks ties
 *  between two time-less rows. Customer and delivery-point columns compare
 *  with Vietnamese collation. VERBATIM from the hook — do not "improve". */
export function compareDetailPlanRows(
  a: DetailPlanSortableRow,
  b: DetailPlanSortableRow,
  sortKey: Exclude<DetailPlanSortKey, null>,
  sortDirection: DetailPlanSortDirection,
): number {
  if (sortKey === 'runHour') {
    const [av, bv] = [a.time.runAt ?? null, b.time.runAt ?? null];
    if (av == null || bv == null) {
      return av != null ? -1 : bv != null ? 1
        : (a.time.runHour ?? 99) - (b.time.runHour ?? 99);
    }
    const cmp = av.localeCompare(bv);
    return sortDirection === 'desc' ? -cmp : cmp;
  }
  const [av, bv] = sortKey === 'customer'
    ? [a.customerRoute.customerName ?? '', b.customerRoute.customerName ?? '']
    : [a.customerRoute.deliveryPoint ?? '', b.customerRoute.deliveryPoint ?? ''];
  const cmp = av.localeCompare(bv, 'vi');
  return sortDirection === 'desc' ? -cmp : cmp;
}
