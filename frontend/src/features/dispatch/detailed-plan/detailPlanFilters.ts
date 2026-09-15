import type { DispatchDetailPlanFilters } from '../../../api/dispatchPlanningClient';

export interface DetailedPlanFilterState extends DispatchDetailPlanFilters {
  q: string;
  date: string;
  direction: 'IMPORT' | 'EXPORT' | '';
  assignmentStatus: 'UNASSIGNED' | 'ASSIGNED' | '';
  pickupIds: number[];
  dropoffIds: number[];
  deliveryPointIds: number[];
  hourFrom: string;
  hourTo: string;
  /** Zone code from the DB taxonomy; '' = no zone filter. */
  zone: string;
}

export const EMPTY_DETAILED_PLAN_FILTERS: DetailedPlanFilterState = {
  q: '',
  date: '',
  direction: '',
  assignmentStatus: '',
  pickupIds: [],
  dropoffIds: [],
  deliveryPointIds: [],
  hourFrom: '',
  hourTo: '',
  zone: '',
};

export function createDefaultDetailedPlanFilters(): DetailedPlanFilterState {
  // No default transport date — /dispatch parity: the grid lists all allocated
  // fulfillments until the dispatcher filters by an explicit day.
  return { ...EMPTY_DETAILED_PLAN_FILTERS };
}

export type DetailPlanSortKey = 'runHour' | 'deliveryPoint' | null;
export type DetailPlanSortDirection = 'asc' | 'desc';

/** Query params shared by the list, load-more, and refresh requests. */
export function detailPlanQuery(filters: DetailedPlanFilterState, q: string) {
  return {
    ...(q ? { q } : {}),
    ...(filters.date ? { date: filters.date } : {}),
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.assignmentStatus ? { assignmentStatus: filters.assignmentStatus } : {}),
    ...(filters.pickupIds.length > 0 ? { pickupIds: filters.pickupIds } : {}),
    ...(filters.dropoffIds.length > 0 ? { dropoffIds: filters.dropoffIds } : {}),
    ...(filters.deliveryPointIds.length > 0 ? { deliveryPointIds: filters.deliveryPointIds } : {}),
    ...(filters.hourFrom ? { hourFrom: filters.hourFrom } : {}),
    ...(filters.hourTo ? { hourTo: filters.hourTo } : {}),
    ...(filters.zone ? { zone: filters.zone } : {}),
  };
}
